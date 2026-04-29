/**
 * Test plugin for E2E testing
 * This plugin registers functions that run outside the sandbox
 */

import { registerTool } from 'mcp-isolated-js';

registerTool(
  'echo',
  'Echoes the message back and checks if MCP_TEST_API_KEY environment variable is set',
  async function echo(message: string): Promise<{ message: string; envCheck: { hasApiKey: boolean } }> {
    // This runs outside the sandbox, so it can access environment variables
    return {
      message: `Echo: ${message}`,
      envCheck: {
        hasApiKey: !!process.env.MCP_TEST_API_KEY,
      },
    };
  }
);

registerTool(
  'fetchUrl',
  'Fetches data from a URL (runs outside sandbox where network is available)',
  async function fetchUrl(args: { url: string }): Promise<{ status: number; data: string }> {
    // This would normally make an HTTP request, but for testing we just return mock data
    return {
      status: 200,
      data: `Mock response from ${args.url}`,
    };
  }
);

registerTool(
  'calculate',
  'Performs arithmetic calculations outside the sandbox',
  function calculate(args: { a: number; b: number; operation: string }): number {
    switch (args.operation) {
      case 'add':
        return args.a + args.b;
      case 'multiply':
        return args.a * args.b;
      default:
        throw new Error(`Unknown operation: ${args.operation}`);
    }
  }
);
