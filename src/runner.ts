import { SandboxManager } from './sandbox-manager.js';
import { PluginSystem } from './plugin-system.js';
import type { ExecutionResult, ToolDefinition, ToolHandler } from './types.js';
import type { z } from 'zod';

export interface IsolatedJsRunnerOptions {
  pluginDirs?: string[];
  loadDefaultPlugins?: boolean;
  sandbox?: SandboxManager;
  plugins?: PluginSystem;
}

/**
 * MCP-independent execution runner.
 *
 * This owns the sandbox lifecycle and host.callTool plugin dispatch, so callers
 * can use the isolated execution engine without running an MCP server.
 */
export class IsolatedJsRunner {
  private sandbox: SandboxManager;
  private plugins: PluginSystem;
  private pluginDirs: string[];
  private loadDefaultPlugins: boolean;
  private started = false;

  constructor(options: IsolatedJsRunnerOptions = {}) {
    this.sandbox = options.sandbox ?? new SandboxManager();
    this.plugins = options.plugins ?? new PluginSystem();
    this.pluginDirs = options.pluginDirs ?? [];
    this.loadDefaultPlugins = options.loadDefaultPlugins ?? false;

    this.setupSandboxHandlers();
  }

  registerTool<TSchema extends z.ZodTypeAny>(
    name: string,
    schema: TSchema,
    handler: ToolHandler<TSchema>,
  ): void {
    this.plugins.registerTool(name, schema, handler);
  }

  registerTools(definitions: ToolDefinition[]): void {
    for (const definition of definitions) {
      this.plugins.registerTool(definition.name, definition.schema, definition.handler);
    }
  }

  async loadPlugins(pluginDirs = this.pluginDirs): Promise<void> {
    await this.plugins.loadPlugins(pluginDirs);
  }

  async start(): Promise<void> {
    if (this.started) return;

    if (this.loadDefaultPlugins) {
      await this.plugins.loadDefaultPlugins();
    }
    await this.loadPlugins();
    await this.sandbox.start();

    this.started = true;
  }

  async executeCode(code: string): Promise<ExecutionResult> {
    return await this.sandbox.executeCode(code);
  }

  getPluginSystem(): PluginSystem {
    return this.plugins;
  }

  stop(): void {
    this.sandbox.stop();
    this.started = false;
  }

  private setupSandboxHandlers(): void {
    this.sandbox.on(
      'request',
      async (method: string, params: unknown, id: string | number | undefined) => {
        if (method === 'host.callTool') {
          const { name, args } = params as { name: string; args: unknown };

          try {
            const result = await this.plugins.callFunction(name, args);
            if (id !== undefined) {
              this.sandbox.respond(id, result);
            }
          } catch (err) {
            if (id !== undefined) {
              this.sandbox.respondError(
                id,
                -32000,
                err instanceof Error ? err.message : String(err),
              );
            }
          }
          return;
        }

        if (id !== undefined) {
          this.sandbox.respondError(id, -32601, `Unknown method: ${method}`);
        }
      },
    );
  }
}
