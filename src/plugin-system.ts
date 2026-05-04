import { z } from 'zod';
import { promises as fs, existsSync } from 'fs';
import * as path from 'path';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'url';
import type {
  PluginFunction,
  RegisterToolOptions,
  ToolHandler,
} from './types.js';

export function getDefaultPluginDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(
    homeDir,
    '.mcp-isolated-coderunner',
    'plugins'
  );
}

export interface PluginSystemOptions {
  pluginDirs?: string[];
}

const PLUGIN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

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
  private pluginDirs: string[];
  private loadedPluginDirs = new Set<string>();

  constructor(options: PluginSystemOptions = {}) {
    this.pluginDirs = options.pluginDirs ?? [];
  }

  registerTool<TSchema extends z.ZodTypeAny>(
    name: string,
    schema: TSchema,
    handler: ToolHandler<TSchema>,
    options: RegisterToolOptions = {}
  ): void {
    const description = options.description ?? schema.description ?? '';
    const registrationApi = new PluginRegistrationApi();
    registrationApi.registerTool(
      name,
      description,
      schema,
      handler as (...args: unknown[]) => unknown
    );

    for (const fn of registrationApi.getFunctions()) {
      this.functions.set(fn.name, fn);
    }
  }

  /**
   * Load all plugins from the default home plugin directory.
   */
  async loadDefaultPlugins(): Promise<void> {
    await this.loadPlugins([getDefaultPluginDir()]);
  }

  /**
   * Load all plugins from one or more plugin directories.
   */
  async loadPlugins(pluginDirs = this.pluginDirs): Promise<void> {
    for (const pluginDir of pluginDirs) {
      await this.loadPluginDir(pluginDir);
    }
  }

  /**
   * Load all plugin files from one plugin directory.
   */
  async loadPluginDir(pluginDir: string): Promise<void> {
    const resolvedDir = path.resolve(pluginDir);
    if (this.loadedPluginDirs.has(resolvedDir)) return;

    try {
      const entries = await fs.readdir(resolvedDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && PLUGIN_EXTENSIONS.has(path.extname(entry.name))) {
          await this.loadPluginFile(path.join(resolvedDir, entry.name));
        }
      }

      this.loadedPluginDirs.add(resolvedDir);
    } catch (err) {
      // Plugins directory doesn't exist or can't be read - that's ok
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Error loading plugins from ${resolvedDir}:`, err);
      }
    }
  }

  /**
   * Load a single plugin file using jiti
   */
  async loadPluginFile(filePath: string): Promise<void> {
    const resolvedFilePath = path.resolve(filePath);

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

      try {
        // Read the plugin source and evaluate it via jiti
        const source = await fs.readFile(resolvedFilePath, 'utf-8');
        await jiti.evalModule(source, { id: resolvedFilePath });
      } finally {
        (bridge as any).clearRegistrar?.();
      }

      // Register all functions from this plugin
      for (const fn of registrationApi.getFunctions()) {
        this.functions.set(fn.name, fn);
        console.error(`[PluginSystem] Registered: ${fn.name}`);
      }
    } catch (err) {
      console.error(`Error loading plugin ${resolvedFilePath}:`, err);
    }
  }

  /**
   * Resolve the absolute path to the plugin-registration-bridge module.
   * Handles both source (.ts) and compiled (.js) environments.
   */
  private resolveBridgeModulePath(): string {
    const srcDir = path.dirname(fileURLToPath(import.meta.url));
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
