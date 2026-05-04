#!/usr/bin/env node
import { McpIsolatedJsServer } from './index.js';

interface CliOptions {
  pluginDirs: string[];
  loadDefaultPlugins: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    pluginDirs: [],
    loadDefaultPlugins: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--plugin-dir') {
      const pluginDir = args[++i];
      if (!pluginDir) {
        throw new Error('--plugin-dir requires a directory path');
      }
      options.pluginDirs.push(pluginDir);
      continue;
    }

    if (arg.startsWith('--plugin-dir=')) {
      options.pluginDirs.push(arg.slice('--plugin-dir='.length));
      continue;
    }

    if (arg === '--no-default-plugins') {
      options.loadDefaultPlugins = false;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp(): void {
  console.log(`Usage: mcp-isolated-js [options]

Options:
  --plugin-dir <path>      Load plugins from a directory. Can be repeated.
  --no-default-plugins     Do not load ~/.mcp-isolated-coderunner/plugins.
  -h, --help               Show this help message.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const server = new McpIsolatedJsServer(options);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    server.stop();
    process.exit(0);
  });

  await server.start();
}

main().catch(console.error);
