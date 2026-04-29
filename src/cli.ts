#!/usr/bin/env node
import { McpIsolatedJsServer } from './index.js';

async function main() {
  const server = new McpIsolatedJsServer();

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
