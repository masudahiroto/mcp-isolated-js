/**
 * Test plugin for E2E testing
 * This plugin registers functions that run outside the sandbox
 */

import { z } from 'zod';
import { registerTool } from 'mcp-isolated-js';

registerTool(
  'echo',
  z.object({
    message: z.string(),
  }).describe('Echoes the message back and checks if MCP_TEST_API_KEY environment variable is set'),
  async (args) => {
    // This runs outside the sandbox, so it can access environment variables
    return {
      message: `Echo: ${args.message}`,
      envCheck: {
        hasApiKey: !!process.env.MCP_TEST_API_KEY,
      },
    };
  }
);

registerTool(
  'fetchUrl',
  z.object({
    url: z.string(),
  }).describe('Fetches data from a URL (runs outside sandbox where network is available)'),
  async (args) => {
    // This would normally make an HTTP request, but for testing we just return mock data
    return {
      status: 200,
      data: `Mock response from ${args.url}`,
    };
  }
);

registerTool(
  'calculate',
  z.object({
    a: z.number(),
    b: z.number(),
    operation: z.string(),
  }).describe('Performs arithmetic calculations outside the sandbox'),
  (args) => {
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
