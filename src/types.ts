import type { z } from 'zod';

/**
 * Plugin registration interface
 */
export interface PluginFunction {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<unknown>;
}

/**
 * Type-safe tool handler signature
 */
export type ToolHandler<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = (
  args: z.infer<TSchema>,
) => Promise<unknown> | unknown;

/**
 * Tool definition with Zod schema
 */
export interface ToolDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  schema: TSchema;
  handler: ToolHandler<TSchema>;
}

/**
 * Sandbox execution request
 */
export interface ExecutionRequest {
  code: string;
  timeout?: number;
}

/**
 * Sandbox execution result
 */
export interface ExecutionResult {
  ok: boolean;
  value?: unknown;
  error?: {
    phase: 'compile' | 'runtime';
    message: string;
    stack?: string;
  };
  logs: string[];
}

/**
 * JSON-RPC message types
 */
export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Host API exposed to sandbox
 */
export interface HostApi {
  callTool: <T = unknown>(name: string, args: unknown) => Promise<T>;
}
