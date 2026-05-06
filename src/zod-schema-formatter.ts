import { z } from 'zod';

/**
 * Lightweight JSON Schema shape used internally for formatting.
 */
interface JsonSchemaShape {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchemaShape>;
  required?: string[];
  items?: JsonSchemaShape;
  enum?: string[];
  default?: unknown;
  additionalProperties?: JsonSchemaShape | boolean;
  [key: string]: unknown;
}

/**
 * Convert a `z.ZodTypeAny` to a human-readable type string using JSON Schema.
 * Falls back to the raw `type` field or "unknown" on failure.
 */
function formatJsonSchemaType(schema: JsonSchemaShape): string {
  if (schema.enum) {
    return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  }
  if (schema.type === 'array' && schema.items) {
    return `${formatJsonSchemaType(schema.items)}[]`;
  }
  if (
    schema.type === 'object' &&
    schema.additionalProperties &&
    typeof schema.additionalProperties === 'object'
  ) {
    return `Record<string, ${formatJsonSchemaType(schema.additionalProperties as JsonSchemaShape)}>`;
  }
  return schema.type ?? 'unknown';
}

/**
 * Build a single-parameter description line.
 */
function formatParameter(name: string, schema: JsonSchemaShape, isRequired: boolean): string {
  const typeStr = formatJsonSchemaType(schema);
  const qualifiers: string[] = [];
  if (isRequired) qualifiers.push('required');
  if (schema.default !== undefined) qualifiers.push(`default: ${JSON.stringify(schema.default)}`);
  const qualifierStr = qualifiers.length > 0 ? `, ${qualifiers.join(', ')}` : '';
  const desc = schema.description ? ` — ${schema.description}` : '';
  return `- ${name} (${typeStr}${qualifierStr})${desc}`;
}

/**
 * Format a complete plugin/tool description from its Zod schema.
 *
 * Produces output like:
 *
 *   ## host.callTool("webFetch")
 *   Fetches content from a URL.
 *
 *   Parameters:
 *   - url (string, required) — The URL to fetch
 *   - method ("GET" | "POST", default: "GET") — HTTP method
 *   - headers (Record<string, string>) — Additional HTTP headers
 */
export function formatToolDescription(name: string, schema: z.ZodTypeAny): string {
  const lines: string[] = [];
  lines.push(`## host.callTool("${name}")`);

  let jsonSchema: JsonSchemaShape;
  try {
    jsonSchema = z.toJSONSchema(schema) as JsonSchemaShape;
  } catch (err) {
    // toJSONSchema may fail for some schema shapes; fall back gracefully
    console.error(
      `[zod-schema-formatter] z.toJSONSchema failed for tool "${name}": ${err instanceof Error ? err.message : String(err)}`,
    );
    const desc = schema.description ?? '';
    lines.push(desc);
    return lines.join('\n');
  }

  if (jsonSchema.description) {
    lines.push(jsonSchema.description);
  }

  if (jsonSchema.properties) {
    lines.push('');
    lines.push('Parameters:');
    const required = new Set(jsonSchema.required ?? []);
    for (const [key, propSchema] of Object.entries(jsonSchema.properties)) {
      lines.push(formatParameter(key, propSchema, required.has(key)));
    }
  }

  return lines.join('\n');
}

/**
 * Build the full description for the execute_js MCP tool, appending
 * information about every plugin that is available via host.callTool().
 */
export function buildExecuteJsDescription(
  plugins: { name: string; schema: z.ZodTypeAny }[],
): string {
  let base =
    'Execute JavaScript code in an isolated sandbox environment. ' +
    'Standard library is available. ' +
    'The result includes both the return value of the code and any output from console.log/console.info/console.warn/console.error.';

  if (plugins.length === 0) {
    return base;
  }

  const toolSections = plugins.map((p) => formatToolDescription(p.name, p.schema)).join('\n\n');

  base +=
    '\n\n' +
    'Plugin tools are available via `await host.callTool(name, args)` (must be awaited).\n' +
    'Example: `const result = await host.callTool("functionName", { param1: value1 }); console.log(result); return 0;`\n\n' +
    toolSections;

  return base;
}
