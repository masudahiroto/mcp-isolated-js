import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { IsolatedJsRunner } from './runner.js';
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
      }
    );

    this.registerMcpTools();
  }

  registerTool<TSchema extends z.ZodTypeAny>(
    name: string,
    schema: TSchema,
    handler: ToolHandler<TSchema>
  ): void {
    this.runner.registerTool(name, schema, handler);
  }

  registerTools(definitions: ToolDefinition[]): void {
    this.runner.registerTools(definitions);
  }

  async start(): Promise<void> {
    await this.runner.start();

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
          'JavaScript code to execute. ' +
            'Use host.callTool("functionName", args) to call plugins.'
        ),
    });

    this.mcpServer.registerTool(
      'execute_js',
      {
        description:
          'Execute JavaScript code in an isolated sandbox environment. ' +
          'Standard library is available. ' +
          'Use host.callTool(name, args) to call plugin functions that run outside the sandbox.',
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
      }
    );
  }
}
