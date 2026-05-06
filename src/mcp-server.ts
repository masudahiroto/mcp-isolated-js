import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { IsolatedJsRunner } from './runner.js';
import { buildExecuteJsDescription } from './zod-schema-formatter.js';
import type { ToolDefinition, ToolHandler } from './types.js';

export interface McpIsolatedJsServerOptions {
  pluginDirs?: string[];
  loadDefaultPlugins?: boolean;
  runner?: IsolatedJsRunner;
  name?: string;
  version?: string;
}

/**
 * MCP adapter for the isolated JavaScript runner.
 */

export class McpIsolatedJsServer {
  private mcpServer: McpServer;
  private runner: IsolatedJsRunner;
  private executeJsTool: RegisteredTool | null = null;

  constructor(options: McpIsolatedJsServerOptions = {}) {
    this.runner =
      options.runner ??
      new IsolatedJsRunner({
        pluginDirs: options.pluginDirs,
        loadDefaultPlugins: options.loadDefaultPlugins ?? true,
      });

    this.mcpServer = new McpServer(
      {
        name: options.name ?? 'mcp-isolated-js',
        version: options.version ?? '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.registerMcpTools();
  }

  registerTool<TSchema extends z.ZodTypeAny>(
    name: string,
    schema: TSchema,
    handler: ToolHandler<TSchema>,
  ): void {
    this.runner.registerTool(name, schema, handler);
  }

  registerTools(definitions: ToolDefinition[]): void {
    this.runner.registerTools(definitions);
  }

  async start(): Promise<void> {
    await this.runner.start();
    this.updateExecuteJsDescription();

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);

    console.error('MCP Isolated JS server running on stdio');
    console.error('Plugins loaded and accessible via host.callTool()');
  }

  stop(): void {
    this.runner.stop();
  }

  getRunner(): IsolatedJsRunner {
    return this.runner;
  }

  private registerMcpTools(): void {
    const inputSchema = z.object({
      code: z
        .string()
        .describe(
          'JavaScript code to execute. Example: const result = await host.callTool("readFile", { path: "/tmp/file" }); console.log(result);',
        ),
    });

    const description =
      'Execute JavaScript code in an isolated sandbox environment. ' +
      'Standard library is available. ' +
      'The result includes both the return value of the code and any output from console.log/console.info/console.warn/console.error. ' +
      'Use await host.callTool(name, args) to call plugin functions that run outside the sandbox.';

    this.executeJsTool = this.mcpServer.registerTool(
      'execute_js',
      {
        description,
        inputSchema,
      },
      async (args) => {
        const result = await this.runner.executeCode(args.code);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      },
    );
  }

  /**
   * Update the execute_js tool description to include plugin information.
   * Must be called after plugins are loaded but before the transport connects.
   */
  private updateExecuteJsDescription(): void {
    if (!this.executeJsTool) return;

    const plugins = this.runner.getPluginSystem().getAllFunctions();
    const description = buildExecuteJsDescription(plugins);

    this.executeJsTool.update({ description });
  }
}
