#!/usr/bin/env bun
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

class E2ETest {
  private serverProcess?: ChildProcess;
  private nextId = 1;
  private pendingResponses = new Map<number, (response: JsonRpcResponse) => void>();
  private buffer = '';

  async start(): Promise<void> {
    const testPluginsDir = path.join(process.cwd(), 'test', 'plugins');
    const pluginsDir = path.join(os.tmpdir(), `mcp-test-${Date.now()}`, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });

    const pluginFiles = fs.readdirSync(testPluginsDir);
    for (const file of pluginFiles) {
      if (file.endsWith('.ts')) {
        fs.copyFileSync(path.join(testPluginsDir, file), path.join(pluginsDir, file));
      }
    }

    fs.writeFileSync(
      path.join(pluginsDir, 'custom-plugin.ts'),
      `
        import { z } from 'zod';
        import { registerTool } from 'mcp-isolated-js';

        registerTool(
          'customValue',
          z.object({ value: z.string() }).describe('Returns a custom plugin value'),
          async (args) => ({ custom: args.value })
        );
      `,
    );

    const env = {
      ...process.env,
      DENO_DIR: process.env.DENO_DIR || path.join(os.tmpdir(), 'mcp-isolated-js-deno-cache'),
      MCP_TEST_API_KEY: 'secret-api-key-12345',
    };

    // Use bun to run TypeScript directly
    const serverPath = path.join(process.cwd(), 'src', 'cli.ts');
    this.serverProcess = spawn(
      'bun',
      ['run', serverPath, '--no-default-plugins', '--plugin-dir', pluginsDir],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      },
    );

    this.serverProcess.stdout?.on('data', (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.serverProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('error')) {
        console.error('[Server stderr]', msg);
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  private handleData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response: JsonRpcResponse = JSON.parse(line);
        const handler = this.pendingResponses.get(response.id);
        if (handler) {
          this.pendingResponses.delete(response.id);
          handler(response);
        }
      } catch {
        // ignore non-JSON lines
      }
    }
  }

  private async sendRequest(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve) => {
      this.pendingResponses.set(id, resolve);
      this.serverProcess?.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  stop(): void {
    if (this.serverProcess) {
      this.serverProcess.stdin?.end();
      this.serverProcess.kill();
      this.serverProcess = undefined;
    }
  }
}

describe('MCP Isolated JS E2E Tests', () => {
  let e2eTest: E2ETest;

  beforeAll(async () => {
    e2eTest = new E2ETest();
    await e2eTest.start();
  });

  afterAll(() => {
    e2eTest.stop();
  });

  test('List tools includes only execute_js', async () => {
    const response = await e2eTest['sendRequest']('tools/list');
    expect(response.error).toBeUndefined();

    const tools = (response.result as any)?.tools || [];
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('execute_js');
  });

  test('Execute simple JavaScript code', async () => {
    const response = await e2eTest['sendRequest']('tools/call', {
      name: 'execute_js',
      arguments: { code: 'return 1 + 1;' },
    });
    expect(response.error).toBeUndefined();

    const result = JSON.parse((response.result as any).content[0].text);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  test('Execute code with console logging', async () => {
    const response = await e2eTest['sendRequest']('tools/call', {
      name: 'execute_js',
      arguments: {
        code: `
          console.log('Hello from sandbox');
          console.info('Info message');
          console.warn('Warning message');
          console.error('Error message');
          return 'done';
        `,
      },
    });
    expect(response.error).toBeUndefined();

    const result = JSON.parse((response.result as any).content[0].text);
    expect(result.ok).toBe(true);

    const logs = result.logs.join(' ');
    expect(logs).toContain('[log] Hello from sandbox');
    expect(logs).toContain('[info] Info message');
  });

  test('Execute async JavaScript code', async () => {
    const response = await e2eTest['sendRequest']('tools/call', {
      name: 'execute_js',
      arguments: {
        code: `
          const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
          await delay(100);
          return { async: true, timestamp: Date.now() };
        `,
      },
    });
    expect(response.error).toBeUndefined();

    const result = JSON.parse((response.result as any).content[0].text);
    expect(result.ok).toBe(true);
    expect(result.value.async).toBe(true);
  });

  test('Execute code that throws error', async () => {
    const response = await e2eTest['sendRequest']('tools/call', {
      name: 'execute_js',
      arguments: { code: `throw new Error('Test error');` },
    });
    expect(response.error).toBeUndefined();

    const result = JSON.parse((response.result as any).content[0].text);
    expect(result.ok).toBe(false);
    expect(result.error?.phase).toBe('runtime');
    expect(result.error?.message).toContain('Test error');
  });

  test('Call plugin function via host.callTool', async () => {
    const response = await e2eTest['sendRequest']('tools/call', {
      name: 'execute_js',
      arguments: {
        code: `
          const result = await host.callTool('calculate', { a: 5, b: 3, operation: 'add' });
          return result;
        `,
      },
    });
    expect(response.error).toBeUndefined();

    const result = JSON.parse((response.result as any).content[0].text);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(8);
  });

  test('Plugin accesses environment variables via host.callTool', async () => {
    const response = await e2eTest['sendRequest']('tools/call', {
      name: 'execute_js',
      arguments: {
        code: `
          const result = await host.callTool('echo', { message: 'Hello World' });
          return result;
        `,
      },
    });
    expect(response.error).toBeUndefined();

    const result = JSON.parse((response.result as any).content[0].text);
    expect(result.ok).toBe(true);
    expect(result.value.message).toBe('Echo: Hello World');
    expect(result.value.envCheck.hasApiKey).toBe(true);
  });

  test('Loads plugin from custom CLI plugin directory', async () => {
    const response = await e2eTest['sendRequest']('tools/call', {
      name: 'execute_js',
      arguments: {
        code: `
          const result = await host.callTool('customValue', { value: 'from-custom-dir' });
          return result;
        `,
      },
    });
    expect(response.error).toBeUndefined();

    const result = JSON.parse((response.result as any).content[0].text);
    expect(result.ok).toBe(true);
    expect(result.value.custom).toBe('from-custom-dir');
  });

  test('Multiple plugin calls in one execution', async () => {
    const response = await e2eTest['sendRequest']('tools/call', {
      name: 'execute_js',
      arguments: {
        code: `
          const addResult = await host.callTool('calculate', { a: 10, b: 20, operation: 'add' });
          const mulResult = await host.callTool('calculate', { a: 10, b: 20, operation: 'multiply' });
          return { addResult, mulResult };
        `,
      },
    });
    expect(response.error).toBeUndefined();

    const result = JSON.parse((response.result as any).content[0].text);
    expect(result.ok).toBe(true);
    expect(result.value.addResult).toBe(30);
    expect(result.value.mulResult).toBe(200);
  });

  test('Plugin functions are not exposed as MCP tools', async () => {
    const response = await e2eTest['sendRequest']('tools/list');
    expect(response.error).toBeUndefined();

    const tools = (response.result as any)?.tools || [];
    const toolNames = tools.map((t: any) => t.name);

    expect(toolNames).not.toContain('plugin_calculate');
    expect(toolNames).not.toContain('plugin_echo');
    expect(toolNames).not.toContain('plugin_fetchUrl');
  });

  test('execute_js description includes plugin tool information', async () => {
    const response = await e2eTest['sendRequest']('tools/list');
    expect(response.error).toBeUndefined();

    const tools = (response.result as any)?.tools || [];
    expect(tools.length).toBe(1);

    const description: string = tools[0].description;
    // Base description must be present
    expect(description).toContain('Execute JavaScript code');

    // Plugin section header
    expect(description).toContain('host.callTool');

    // Each loaded plugin should appear in the description
    expect(description).toContain('host.callTool("echo")');
    expect(description).toContain('host.callTool("fetchUrl")');
    expect(description).toContain('host.callTool("calculate")');
    expect(description).toContain('host.callTool("customValue")');

    // Plugin descriptions from their Zod schemas
    expect(description).toContain('Echoes the message back');
    expect(description).toContain('Fetches data from a URL');
    expect(description).toContain('Performs arithmetic calculations');
    expect(description).toContain('Returns a custom plugin value');

    // Schema parameter details should be present
    expect(description).toContain('message');
    expect(description).toContain('url');
    expect(description).toContain('a');
    expect(description).toContain('b');
    expect(description).toContain('operation');
    expect(description).toContain('value');
  });

  test('Syntax error is properly caught', async () => {
    const response = await e2eTest['sendRequest']('tools/call', {
      name: 'execute_js',
      arguments: { code: `return { invalid syntax here` },
    });
    expect(response.error).toBeUndefined();

    const result = JSON.parse((response.result as any).content[0].text);
    expect(result.ok).toBe(false);
    expect(result.error?.phase).toBe('compile');
  });

  test('Network access is blocked in sandbox', async () => {
    const response = await e2eTest['sendRequest']('tools/call', {
      name: 'execute_js',
      arguments: {
        code: `
          try {
            const response = await fetch('https://example.com');
            return { success: true, status: response.status };
          } catch (err) {
            return { success: false, error: err.message };
          }
        `,
      },
    });
    expect(response.error).toBeUndefined();

    const result = JSON.parse((response.result as any).content[0].text);
    expect(result.ok).toBe(true);

    // fetch should fail in sandbox
    expect(result.value.success).toBe(false);

    const errorMsg = result.value?.error || '';
    const hasPermissionError =
      errorMsg.toLowerCase().includes('permission') ||
      errorMsg.toLowerCase().includes('not allowed') ||
      errorMsg.toLowerCase().includes('denied') ||
      errorMsg.toLowerCase().includes('requires net access') ||
      errorMsg.toLowerCase().includes('--allow-net');
    expect(hasPermissionError).toBe(true);
  });

  test('Network access works via plugin (outside sandbox)', async () => {
    const response = await e2eTest['sendRequest']('tools/call', {
      name: 'execute_js',
      arguments: {
        code: `
          const result = await host.callTool('fetchUrl', { url: 'https://example.com' });
          return result;
        `,
      },
    });
    expect(response.error).toBeUndefined();

    const result = JSON.parse((response.result as any).content[0].text);
    expect(result.ok).toBe(true);
    expect(result.value.status).toBe(200);
    expect(result.value.data).toContain('example.com');
  });
});
