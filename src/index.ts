import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SandboxManager } from './sandbox-manager.js';
import { PluginSystem } from './plugin-system.js';
import { ExecutionResult } from './types.js';

export { SandboxManager } from './sandbox-manager.js';
export { PluginSystem } from './plugin-system.js';
export { registerTool } from './plugin-registration-bridge.js';
export type { ExecutionResult, ToolDefinition, ToolHandler } from './types.js';

/**
 * MCP Server that executes TypeScript code in an isolated Deno sandbox
 * with support for host-side plugin functions via host.callTool()
 */
export class McpIsolatedJsServer {
  private mcpServer: McpServer;
  private sandbox: SandboxManager;
  private plugins: PluginSystem;

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'mcp-isolated-js',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.sandbox = new SandboxManager();
    this.plugins = new PluginSystem();

    this.registerTools();
    this.setupSandboxHandlers();
  }

  /**
   * Register MCP tools using the high-level McpServer API
   */
  private registerTools(): void {
    const inputSchema = z.object({
      code: z
        .string()
        .describe(
          'TypeScript/JavaScript code to execute. ' +
            'Use host.callTool("functionName", args) to call plugins.'
        ),
    });

    this.mcpServer.registerTool(
      'execute_js',
      {
        description:
          'Execute TypeScript/JavaScript code in an isolated sandbox environment. ' +
          'Standard library is available. ' +
          'Use host.callTool(name, args) to call plugin functions that run outside the sandbox.',
        inputSchema,
      },
      async (args) => {
        const result = await this.executeCode(args.code);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
    );
  }

  /**
   * Set up sandbox request handlers (host.callTool from sandbox)
   * Plugins are accessed ONLY via this mechanism, not as separate MCP tools
   */
  private setupSandboxHandlers(): void {
    this.sandbox.on(
      'request',
      async (
        method: string,
        params: unknown,
        id: string | number | undefined
      ) => {
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
                err instanceof Error ? err.message : String(err)
              );
            }
          }
        } else {
          if (id !== undefined) {
            this.sandbox.respondError(
              id,
              -32601,
              `Unknown method: ${method}`
            );
          }
        }
      }
    );
  }

  /**
   * Execute code in the sandbox
   */
  private async executeCode(code: string): Promise<ExecutionResult> {
    return await this.sandbox.executeCode(code);
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    // Load plugins (available via host.callTool() only)
    await this.plugins.loadPlugins();

    // Start sandbox
    await this.sandbox.start();

    // Connect transport
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);

    console.error('MCP Isolated JS server running on stdio');
    console.error('Plugins loaded and accessible via host.callTool()');
  }

  /**
   * Stop the server
   */
  stop(): void {
    this.sandbox.stop();
  }
}


