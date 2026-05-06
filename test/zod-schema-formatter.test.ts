#!/usr/bin/env bun
import { describe, test, expect, spyOn } from 'bun:test';
import { z } from 'zod';
import { formatToolDescription, buildExecuteJsDescription } from '../src/zod-schema-formatter.js';

describe('formatToolDescription', () => {
  test('formats a simple object schema', () => {
    const schema = z
      .object({
        name: z.string().describe('Name to greet'),
      })
      .describe('Greets a person by name');

    const result = formatToolDescription('hello', schema);

    expect(result).toContain('## host.callTool("hello", ...)');
    expect(result).toContain('Greets a person by name');
    expect(result).toContain('- name (string, required)');
    expect(result).toContain('Name to greet');
  });

  test('formats schema with optional and default fields', () => {
    const schema = z
      .object({
        url: z.string().describe('The URL to fetch'),
        method: z
          .enum(['GET', 'POST', 'PUT', 'DELETE'])
          .optional()
          .default('GET')
          .describe('HTTP method'),
        body: z.string().optional().describe('Request body'),
      })
      .describe('Fetches content from a URL');

    const result = formatToolDescription('webFetch', schema);

    expect(result).toContain('## host.callTool("webFetch", ...)');
    expect(result).toContain('Fetches content from a URL');
    expect(result).toContain('- url (string, required)');
    expect(result).toContain('The URL to fetch');
    expect(result).toContain('"GET" | "POST" | "PUT" | "DELETE"');
    expect(result).toContain('default: "GET"');
    expect(result).toContain('Request body');
  });

    test('formats schema with array type', () => {
    const schema = z
      .object({
        items: z.array(z.string()).describe('List of items'),
      })
      .describe('Processes items');

    const result = formatToolDescription('processItems', schema);

    expect(result).toContain('- items (string[], required)');
  });

  test('handles schema without properties', () => {
    const schema = z.string().describe('A simple string');

    const result = formatToolDescription('simple', schema);

    expect(result).toContain('## host.callTool("simple", ...)');
    expect(result).toContain('A simple string');
    expect(result).not.toContain('Parameters:');
  });

  test('handles schema without description', () => {
    const schema = z.object({
      value: z.number(),
    });

    const result = formatToolDescription('noDesc', schema);

    expect(result).toContain('## host.callTool("noDesc", ...)');
    expect(result).toContain('- value (number, required)');
  });
});

describe('buildExecuteJsDescription', () => {
  test('returns base description when no plugins', () => {
    const result = buildExecuteJsDescription([]);
    expect(result).toBe(
      'Execute JavaScript code in an isolated sandbox environment. Standard library is available. The result includes both the return value of the code and any output from console.log/console.info/console.warn/console.error.',
    );
  });

  test('appends plugin descriptions when plugins are provided', () => {
    const plugins = [
      {
        name: 'hello',
        schema: z
          .object({ name: z.string().describe('Name to greet') })
          .describe('Greets a person by name'),
      },
    ];

    const result = buildExecuteJsDescription(plugins);

    expect(result).toContain('Execute JavaScript code in an isolated sandbox environment.');
    expect(result).toContain('await host.callTool');
    expect(result).toContain('host.callTool("hello", ...)');
    expect(result).toContain('Greets a person by name');
    expect(result).toContain('- name (string, required)');
  });

  test('includes multiple plugins', () => {
    const plugins = [
      {
        name: 'hello',
        schema: z.object({ name: z.string() }).describe('Greets a person'),
      },
      {
        name: 'add',
        schema: z.object({ a: z.number(), b: z.number() }).describe('Adds two numbers'),
      },
    ];

    const result = buildExecuteJsDescription(plugins);

    expect(result).toContain('host.callTool("hello", ...)');
    expect(result).toContain('host.callTool("add", ...)');
  });

  test('handles record type gracefully (toJSONSchema may fail)', () => {
    const plugins = [
      {
        name: 'envVars',
        schema: z
          .object({
            vars: z.record(z.string(), z.string()).optional().describe('Environment variables'),
          })
          .describe('Sets environment variables'),
      },
    ];

    // Should not throw even if toJSONSchema fails on z.record
    const result = buildExecuteJsDescription(plugins);
    expect(result).toContain('host.callTool("envVars", ...)');
  });

  test('logs error and falls back when z.toJSONSchema fails', () => {
    const schema = z.object({ name: z.string() }).describe('A simple tool');

    const spy = spyOn(z, 'toJSONSchema').mockImplementation(() => {
      throw new Error('forced toJSONSchema failure');
    });
    const consoleSpy = spyOn(console, 'error').mockImplementation(() => {});

    const result = formatToolDescription('testTool', schema);

    expect(result).toContain('## host.callTool("testTool")');
    expect(result).toContain('A simple tool');
    expect(result).not.toContain('Parameters:');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[zod-schema-formatter] z.toJSONSchema failed for tool "testTool"'),
    );

    spy.mockRestore();
    consoleSpy.mockRestore();
  });
});
