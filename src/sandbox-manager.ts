import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { JsonRpcRequest, JsonRpcResponse, JsonRpcId, ExecutionResult } from './types.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export interface SandboxManagerOptions {
  sandboxPath?: string;
  denoPath?: string;
}

/**
 * Manages the Deno sandbox process and communication via stdin/stdout
 * Network access is NOT allowed in the sandbox for security
 */
export class SandboxManager extends EventEmitter {
  private process?: ChildProcess;
  private pendingRequests = new Map<NonNullable<JsonRpcId>, PendingRequest>();
  private nextId = 1;
  private isReady = false;
  private buffer = '';
  private sandboxPath?: string;
  private denoPath?: string;

  constructor(options: SandboxManagerOptions = {}) {
    super();
    this.sandboxPath = options.sandboxPath;
    this.denoPath = options.denoPath;
  }

  /**
   * Start the sandbox process
   * Network access is disabled (--allow-net is NOT passed)
   */
  async start(): Promise<void> {
    const sandboxPath = this.sandboxPath ?? this.resolveSandboxPath();
    const denoPath = this.denoPath ?? process.env.DENO_PATH ?? this.findDenoPath();
    const sandboxConfigPath = path.join(path.dirname(sandboxPath), 'deno.json');
    const denoArgs = [
      'run',
      ...(fs.existsSync(sandboxConfigPath) ? ['--config', sandboxConfigPath] : []),

      sandboxPath,
    ];

    // Spawn Deno process WITHOUT network access
    // --allow-net is intentionally NOT included
    this.process = spawn(denoPath, denoArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH || '',
        ...(process.env.DENO_DIR ? { DENO_DIR: process.env.DENO_DIR } : {}),
      },
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error('[sandbox]', msg);
    });

    this.process.on('error', (err) => {
      console.error('[sandbox] Process error:', err);
      this.emit('error', err);
    });

    this.process.on('exit', (code) => {
      this.emit('exit', code);
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error('Sandbox process exited'));
      }
      this.pendingRequests.clear();
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    this.isReady = true;
  }

  /**
   * Find Deno executable path
   */
  private findDenoPath(): string {
    const homeDir = os.homedir();
    const candidates = [
      process.env.DENO_INSTALL ? path.join(process.env.DENO_INSTALL, 'bin', 'deno') : '',
      path.join(homeDir, '.deno', 'bin', 'deno'),
      path.join(homeDir, '.local', 'bin', 'deno'),
      '/usr/local/bin/deno',
      '/opt/homebrew/bin/deno',
      'deno',
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        /* continue */
      }
    }
    return 'deno';
  }

  private resolveSandboxPath(): string {
    if (process.env.MCP_ISOLATED_JS_SANDBOX_PATH) {
      return process.env.MCP_ISOLATED_JS_SANDBOX_PATH;
    }

    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.join(moduleDir, '..', 'sandbox', 'sandbox.ts'),
      path.join(moduleDir, 'sandbox', 'sandbox.ts'),
      path.join(process.cwd(), 'sandbox', 'sandbox.ts'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0];
  }

  private handleData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch {
        console.error('[SandboxManager] Invalid JSON:', line.slice(0, 200));
      }
    }
  }

  private handleMessage(msg: JsonRpcResponse | JsonRpcRequest): void {
    // Check if it's a response (has result or error)
    if (
      msg.id !== undefined &&
      msg.id !== null &&
      (('result' in msg && msg.result !== undefined) || ('error' in msg && msg.error !== undefined))
    ) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message || 'Unknown error'));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
    // It's a request from sandbox to host
    else if ('method' in msg && msg.method) {
      this.emit('request', msg.method, msg.params, msg.id);
    }
  }

  private sendRaw(message: string): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('Sandbox process not running');
    }
    this.process.stdin.write(message + '\n');
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });

    this.sendRaw(JSON.stringify(request));
    return promise;
  }

  respond(id: JsonRpcId, result: unknown): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };
    this.sendRaw(JSON.stringify(response));
  }

  respondError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    };
    this.sendRaw(JSON.stringify(response));
  }

  async executeCode(code: string): Promise<ExecutionResult> {
    return (await this.request('runUserCode', { code })) as ExecutionResult;
  }

  stop(): void {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = undefined;
    }
  }
}
