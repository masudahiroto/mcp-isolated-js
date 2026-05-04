/**
 * Web Fetch Plugin Example
 *
 * Demonstrates how to create a plugin that fetches web content from URLs.
 * Since network access is blocked inside the sandbox, plugins running on
 * the host side can provide network capabilities to sandboxed code via
 * host.callTool().
 *
 * Usage:
 *   mcp-isolated-js --plugin-dir ./examples/plugins
 *
 * Then from sandbox code:
 *   const result = await host.callTool('webFetch', { url: 'https://example.com' });
 */

import { z } from 'zod';
import { registerTool } from 'mcp-isolated-js';

registerTool(
  'webFetch',
  z
    .object({
      url: z.string().describe('The URL to fetch'),
      method: z
        .enum(['GET', 'POST', 'PUT', 'DELETE'])
        .optional()
        .default('GET')
        .describe('HTTP method'),
      headers: z
        .record(z.string())
        .optional()
        .describe('Additional HTTP headers'),
      body: z
        .string()
        .optional()
        .describe('Request body for POST/PUT requests'),
    })
    .describe(
      'Fetches content from a URL. Returns status code, headers, and body text.'
    ),
  async (args) => {
    const fetchOptions: RequestInit = {
      method: args.method,
      headers: {
        'User-Agent': 'mcp-isolated-js-webFetch-plugin/1.0',
        ...(args.headers ?? {}),
      },
    };

    if (args.body && (args.method === 'POST' || args.method === 'PUT')) {
      fetchOptions.body = args.body;
    }

    const response = await fetch(args.url, fetchOptions);
    const text = await response.text();

    return {
      url: args.url,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: text,
    };
  }
);

registerTool(
  'webFetchJSON',
  z
    .object({
      url: z.string().describe('The URL to fetch (expected to return JSON)'),
      method: z
        .enum(['GET', 'POST'])
        .optional()
        .default('GET')
        .describe('HTTP method'),
      headers: z
        .record(z.string())
        .optional()
        .describe('Additional HTTP headers'),
      body: z
        .string()
        .optional()
        .describe('Request body for POST requests'),
    })
    .describe(
      'Fetches JSON content from a URL. Returns parsed JSON data.'
    ),
  async (args) => {
    const fetchOptions: RequestInit = {
      method: args.method,
      headers: {
        'User-Agent': 'mcp-isolated-js-webFetch-plugin/1.0',
        Accept: 'application/json',
        ...(args.headers ?? {}),
      },
    };

    if (args.body && args.method === 'POST') {
      fetchOptions.body = args.body;
      if (!args.headers?.['Content-Type']) {
        (fetchOptions.headers as Record<string, string>)['Content-Type'] =
          'application/json';
      }
    }

    const response = await fetch(args.url, fetchOptions);
    const data = await response.json();

    return {
      url: args.url,
      status: response.status,
      data,
    };
  }
);