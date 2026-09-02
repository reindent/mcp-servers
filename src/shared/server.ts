import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { RateLimiter } from './ratelimit.js';
import { MemoryRateLimiter } from './ratelimit.js';
import { ToolError, toPublicError } from './errors.js';
import { log, redact } from './logging.js';

/**
 * The shared server factory. Both public servers are built from this, so the
 * non-functional guarantees are implemented ONCE and cannot drift apart:
 * every tool gets rate limiting, structured audit logging, a uniform error
 * envelope, and JSON content that an agent can parse.
 *
 * Read-only by construction: `registerReadTool` is the only registration path
 * exposed, and it stamps every tool with the MCP annotations that advertise
 * that fact to clients (readOnlyHint / destructiveHint / openWorldHint).
 */
export type ToolSpec<TShape extends Record<string, unknown>> = {
  name: string;
  title: string;
  description: string;
  inputSchema: TShape;
  handler: (args: never) => Promise<unknown>;
};

export type ServerHandle = {
  server: McpServer;
  registerReadTool: <TShape extends Record<string, unknown>>(spec: ToolSpec<TShape>) => void;
  serveStdio: () => Promise<void>;
};

export function createServer(opts: {
  name: string;
  version: string;
  instructions: string;
  limiter?: RateLimiter;
}): ServerHandle {
  const limiter = opts.limiter ?? new MemoryRateLimiter();
  const server = new McpServer(
    { name: opts.name, version: opts.version },
    { instructions: opts.instructions },
  );

  function registerReadTool<TShape extends Record<string, unknown>>(spec: ToolSpec<TShape>): void {
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema as never,
        annotations: {
          // Advertised to the client so an agent knows this cannot mutate anything.
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      (async (args: Record<string, unknown>) => {
        const started = Date.now();
        // One process serves one client over stdio, so a single bucket is the
        // correct granularity here. A hosted transport would key this per client.
        const gate = await limiter.check('stdio');
        if (!gate.allowed) {
          log({
            ts: new Date().toISOString(),
            server: opts.name,
            tool: spec.name,
            outcome: 'rate_limited',
            ms: Date.now() - started,
          });
          return errorContent(
            'rate_limited',
            `Too many requests. Try again after ${new Date(gate.resetAt).toISOString()}.`,
          );
        }

        try {
          const result = await spec.handler(args as never);
          log({
            ts: new Date().toISOString(),
            server: opts.name,
            tool: spec.name,
            outcome: 'ok',
            ms: Date.now() - started,
            params: redact(args),
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          const pub = toPublicError(err);
          log({
            ts: new Date().toISOString(),
            server: opts.name,
            tool: spec.name,
            outcome: 'error',
            ms: Date.now() - started,
            code: pub.code,
            params: redact(args),
          });
          return errorContent(pub.code, pub.message);
        }
      }) as never,
    );
  }

  async function serveStdio(): Promise<void> {
    // stdout belongs to the protocol; everything human-readable goes to stderr.
    await server.connect(new StdioServerTransport());
    process.stderr.write(
      `${JSON.stringify({ ts: new Date().toISOString(), server: opts.name, event: 'ready', transport: 'stdio' })}\n`,
    );
  }

  return { server, registerReadTool, serveStdio };
}

function errorContent(code: string, message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: { code, message } }, null, 2) }],
  };
}

export { ToolError };
