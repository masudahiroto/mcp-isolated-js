import { TextLineStream } from "jsr:@std/streams";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: any;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type HostApi = {
  callTool: (name: string, args: unknown) => Promise<unknown>;
};

// Simple JSON-RPC peer using Deno.serve for bidirectional communication
class JsonRpcPeer {
  private pending = new Map<JsonRpcId, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private nextId = 1;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private onRequest: (method: string, params: any, id?: JsonRpcId) => Promise<any> | any;

  constructor(
    writable: WritableStream<Uint8Array>,
    onRequest: (method: string, params: any, id?: JsonRpcId) => Promise<any> | any,
  ) {
    this.writer = writable.getWriter();
    this.onRequest = onRequest;
  }

  async startReading(readable: ReadableStream<Uint8Array>): Promise<void> {
    const lines = readable
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream());

    for await (const line of lines) {
      if (!line.trim()) continue;

      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        console.error("[sandbox] invalid json");
        continue;
      }

      // Handle responses (has result or error and id exists in pending)
      if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
        const waiter = this.pending.get(msg.id);
        if (waiter) {
          this.pending.delete(msg.id);
          if (msg.error) {
            waiter.reject(new Error(msg.error.message || "JSON-RPC error"));
          } else {
            waiter.resolve(msg.result);
          }
        }
        continue;
      }

      // Handle incoming requests
      if (msg.method) {
        // Handle async
        this.handleRequest(msg).catch(console.error);
      }
    }
  }

  private async handleRequest(msg: JsonRpcRequest): Promise<void> {
    try {
      const result = await this.onRequest(msg.method, msg.params, msg.id);
      if (msg.id !== undefined) {
        await this.send({
          jsonrpc: "2.0",
          id: msg.id,
          result,
        });
      }
    } catch (err) {
      if (msg.id !== undefined) {
        await this.send({
          jsonrpc: "2.0",
          id: msg.id,
          error: {
            code: -32000,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  }

  private async send(message: JsonRpcResponse | JsonRpcRequest) {
    const line = JSON.stringify(message) + "\n";
    await this.writer.write(new TextEncoder().encode(line));
  }

  async request(method: string, params?: any): Promise<unknown> {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    await this.send({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    // Set timeout
    const timeout = setTimeout(() => {
      const w = this.pending.get(id);
      if (w) {
        this.pending.delete(id);
        w.reject(new Error("Request timeout"));
      }
    }, 10000);

    try {
      const result = await promise;
      clearTimeout(timeout);
      return result;
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  }
}

// Create peer for stdin/stdout communication with host
const peer = new JsonRpcPeer(Deno.stdout.writable, async (method, params, id) => {
  if (method === "runUserCode") {
    return await runUserCode(params?.code ?? "");
  }
  throw new Error(`Unknown method: ${method}`);
});

// Start reading in background
const readingPromise = peer.startReading(Deno.stdin.readable);

function createSandboxConsole(logs: string[]) {
  return {
    log: (...args: unknown[]) => {
      logs.push(`[log] ${args.map(formatValue).join(" ")}`);
    },
    info: (...args: unknown[]) => {
      logs.push(`[info] ${args.map(formatValue).join(" ")}`);
    },
    warn: (...args: unknown[]) => {
      logs.push(`[warn] ${args.map(formatValue).join(" ")}`);
    },
    error: (...args: unknown[]) => {
      logs.push(`[error] ${args.map(formatValue).join(" ")}`);
    },
  };
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function runUserCode(code: string) {
  const logs: string[] = [];

  const host: HostApi = {
    callTool: async (name: string, args: unknown) => {
      return await peer.request("host.callTool", { name, args });
    },
  };

  const sandboxConsole = createSandboxConsole(logs);

  const wrappedSource = `
    "use strict";
    return (async ({ host, console }) => {
      ${code}
    });
  `;

  let fn: (context: { host: HostApi; console: ReturnType<typeof createSandboxConsole> }) => Promise<unknown>;

  try {
    fn = new Function(wrappedSource)();
  } catch (err) {
    return {
      ok: false,
      error: {
        phase: "compile",
        message: err instanceof Error ? err.message : String(err),
      },
      logs,
    };
  }

  try {
    const value = await fn({ host, console: sandboxConsole });
    return { ok: true, value, logs };
  } catch (err) {
    return {
      ok: false,
      error: {
        phase: "runtime",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      logs,
    };
  }
}

// Keep alive until stdin closes
await readingPromise;
