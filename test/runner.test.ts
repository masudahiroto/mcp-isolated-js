#!/usr/bin/env bun
import { describe, test, expect, afterEach } from "bun:test";
import { z } from 'zod';
import { IsolatedJsRunner } from '../src/index.js';

describe('IsolatedJsRunner', () => {
  let runner: IsolatedJsRunner | undefined;

  afterEach(() => {
    runner?.stop();
    runner = undefined;
  });

  test('registers plugins programmatically and executes code without MCP', async () => {
    runner = new IsolatedJsRunner();
    runner.registerTool(
      'add',
      z.object({
        a: z.number(),
        b: z.number(),
      }),
      async ({ a, b }) => a + b
    );

    await runner.start();
    const result = await runner.executeCode(`
      return await host.callTool('add', { a: 2, b: 5 });
    `);

    expect(result.ok).toBe(true);
    expect(result.value).toBe(7);
  });
});
