/**
 * Bridge module that allows plugin files to register tools via
 * import { registerTool } from 'mcp-isolated-js'
 *
 * The registrar is set by PluginSystem before loading each plugin.
 */

export interface Registrar {
  registerTool(
    name: string,
    description: string,
    handler: (...args: unknown[]) => unknown
  ): void;
}

let currentRegistrar: Registrar | null = null;

export function setRegistrar(registrar: Registrar): void {
  currentRegistrar = registrar;
}

export function clearRegistrar(): void {
  currentRegistrar = null;
}

export function registerTool(
  name: string,
  description: string,
  handler: (...args: unknown[]) => unknown
): void {
  if (!currentRegistrar) {
    throw new Error(
      'registerTool() called outside of plugin loading context. ' +
        'Make sure you are importing registerTool from "mcp-isolated-js" inside a plugin file.'
    );
  }
  currentRegistrar.registerTool(name, description, handler);
}
