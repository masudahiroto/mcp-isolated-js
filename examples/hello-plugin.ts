/**
 * Sample plugin demonstrating type-safe tool registration with Zod schemas.
 *
 * Install this plugin to ~/.mcp-isolated-coderunner/plugins/hello-plugin.ts
 * to make it available via host.callTool() from the sandbox.
 */

import { z } from 'zod';
import { registerTool } from 'mcp-isolated-js';

registerTool(
  'hello',
  z
    .object({
      name: z.string().describe('Name to greet'),
    })
    .describe('Greets a person by name'),
  async (args) => {
    return {
      greeting: `Hello, ${args.name}!`,
    };
  }
);
