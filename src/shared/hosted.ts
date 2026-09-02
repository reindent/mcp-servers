import { timingSafeEqual } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { ServerHandle } from './server.js';

/**
 * The hosted transport: fetch-standard Request in, Response out.
 *
 * STATELESS BY DESIGN. Every request builds a fresh server + transport and tears it
 * down after the response. No session ids, no affinity, no memory between calls —
 * which is what makes it correct on Lambda, where any request may land on any
 * instance. Tool calls are single request/response, so nothing needs a session.
 *
 * ORIGIN PROTECTION. Cloudflare fronts both hostnames and adds `x-origin-secret`;
 * the Lambda rejects anything without it. That closes the path where someone finds
 * the raw Function URL and calls it directly, bypassing the edge rate limiting —
 * which would otherwise make the WAF rules decorative. Constant-time compare so the
 * secret cannot be recovered by timing.
 */
export type HostedOptions = {
  build: () => ServerHandle;
  /** Shared secret the edge must present. If unset (local dev only), no check. */
  originSecret?: string;
  /** Public hostnames this deployment answers for. Others are refused. */
  allowedHosts?: string[];
  /**
   * The one path the MCP endpoint lives at. Required, never defaulted: a hostname dedicated
   * to a server puts the endpoint at the bare hostname (`/`); a hostname shared with a site
   * puts it under a path (`/mcp`). Anything else answers 404.
   */
  path: string;
};

export type FetchHandler = (req: Request) => Promise<Response>;

export function createFetchHandler(opts: HostedOptions): FetchHandler {
  const path = opts.path;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (url.pathname === '/healthz') return json(200, { ok: true });
    if (url.pathname !== path) {
      return json(404, { error: { code: 'not_found', message: 'Not found.' } });
    }

    if (opts.originSecret !== undefined) {
      const presented = req.headers.get('x-origin-secret') ?? '';
      if (!safeEqual(presented, opts.originSecret)) {
        return json(403, { error: { code: 'forbidden', message: 'Origin check failed.' } });
      }
    }

    if (opts.allowedHosts && opts.allowedHosts.length > 0) {
      const host = (req.headers.get('x-forwarded-host') ?? url.host).toLowerCase();
      if (!opts.allowedHosts.includes(host)) {
        return json(403, { error: { code: 'forbidden', message: 'Host not served here.' } });
      }
    }

    const handle = opts.build();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true, // plain JSON replies; no SSE stream to keep open on Lambda
    });
    await handle.server.connect(transport);
    try {
      return await transport.handleRequest(req);
    } finally {
      await transport.close().catch(() => undefined);
    }
  };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
