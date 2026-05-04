/**
 * Bridge module that allows plugin files to register tools via
 * import { registerTool } from 'mcp-isolated-js'
 *
 * The registrar is set by PluginSystem before loading each plugin.
 */

import type { z } from 'zod';
import type { ToolHandler } from './types.js';

export interface Registrar {
  registerTool(name: string, schema: z.ZodTypeAny, handler: (...args: unknown[]) => unknown): void;
}

let currentRegistrar: Registrar | null = null;

export function setRegistrar(registrar: Registrar): void {
  currentRegistrar = registrar;
}

export function clearRegistrar(): void {
  currentRegistrar = null;
}

export function registerTool<TSchema extends z.ZodTypeAny>(
  name: string,
  schema: TSchema,
  handler: ToolHandler<TSchema>,
): void {
  if (!currentRegistrar) {
    throw new Error(
      'registerTool() called outside of plugin loading context. ' +
        'Make sure you are importing registerTool from "mcp-isolated-js" inside a plugin file.',
    );
  }

  if (typeof handler !== 'function') {
    throw new Error('Handler must be a function');
  }

  currentRegistrar.registerTool(name, schema, handler as (...args: unknown[]) => unknown);
}
