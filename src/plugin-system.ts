import { z } from 'zod';
import { promises as fs, existsSync } from 'fs';
import * as path from 'path';
import { createJiti } from 'jiti';
import { PluginFunction } from './types.js';

const PLUGINS_DIR = path.join(process.env.HOME || '', '.mcp-isolated-coderunner', 'plugins');

/**
 * Plugin registration API exposed to plugin files
 */
class PluginRegistrationApi {
  private functions: PluginFunction[] = [];

  registerTool(
    name: string,
    description: string,
    schema: z.ZodTypeAny,
    handler: (...args: unknown[]) => unknown
  ): void {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Name must be a non-empty string');
    }
    if (typeof description !== 'string') {
      throw new Error('Description must be a string');
    }

    this.functions.push({
      name,
      description,
      schema,
      handler: async (args: unknown) => {
        // Handle both array and object args
        if (Array.isArray(args)) {
          return await handler(...args);
        }
        return await handler(args);
      },
    });
  }

  getFunctions(): PluginFunction[] {
    return this.functions;
  }
}

/**
 * Plugin system that loads and manages plugin functions via jiti
 */
export class PluginSystem {
  private functions = new Map<string, PluginFunction>();
  private loaded = false;

  /**
   * Load all plugins from the plugins directory
   */
  async loadPlugins(): Promise<void> {
    if (this.loaded) return;

    try {
      const entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.ts')) {
          await this.loadPluginFile(path.join(PLUGINS_DIR, entry.name));
        }
      }

      this.loaded = true;
    } catch (err) {
      // Plugins directory doesn't exist or can't be read - that's ok
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Error loading plugins:', err);
      }
    }
  }

  /**
   * Load a single plugin file using jiti
   */
  private async loadPluginFile(filePath: string): Promise<void> {
    try {
      const registrationApi = new PluginRegistrationApi();

      // Resolve the bridge module path (must be absolute for alias safety)
      const bridgePath = this.resolveBridgeModulePath();

      // Create a jiti instance that intercepts 'mcp-isolated-js' imports
      const jiti = createJiti(import.meta.url, {
        alias: {
          'mcp-isolated-js': bridgePath,
        },
      });

      // Load the bridge module and bind the registrar for this plugin
      const bridge = await jiti.import(bridgePath);
      (bridge as any).setRegistrar({
        registerTool: registrationApi.registerTool.bind(registrationApi),
      });

      // Read the plugin source and evaluate it via jiti
      const source = await fs.readFile(filePath, 'utf-8');
      await jiti.evalModule(source, { id: filePath });

      // Register all functions from this plugin
      for (const fn of registrationApi.getFunctions()) {
        this.functions.set(fn.name, fn);
        console.error(`[PluginSystem] Registered: ${fn.name}`);
      }
    } catch (err) {
      console.error(`Error loading plugin ${filePath}:`, err);
    }
  }

  /**
   * Resolve the absolute path to the plugin-registration-bridge module.
   * Handles both source (.ts) and compiled (.js) environments.
   */
  private resolveBridgeModulePath(): string {
    const srcDir = path.dirname(new URL(import.meta.url).pathname);
    const candidates = [
      path.join(srcDir, 'plugin-registration-bridge.ts'),
      path.join(srcDir, 'plugin-registration-bridge.js'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    // Fallback to the .ts path so jiti can at least try to resolve it
    return candidates[0];
  }

  /**
   * Get all registered functions
   */
  getAllFunctions(): PluginFunction[] {
    return Array.from(this.functions.values());
  }

  /**
   * Call a plugin function by name
   */
  async callFunction(name: string, args: unknown): Promise<unknown> {
    const fn = this.functions.get(name);
    if (!fn) {
      throw new Error(`Unknown function: ${name}`);
    }
    const parsed = fn.schema.parse(args);
    return await fn.handler(parsed);
  }

  /**
   * Check if a function exists
   */
  hasFunction(name: string): boolean {
    return this.functions.has(name);
  }
}
