import { createServer as createNodeServer } from 'node:http';
import type { FetchHandler } from './hosted.js';

/**
 * Localhost runner for the hosted handler, so the HTTP path can be exercised end to
 * end on this machine with nothing internet-reachable. Binds 127.0.0.1 only.
 */
export function serveLocal(handler: FetchHandler, port: number): Promise<() => Promise<void>> {
  const server = createNodeServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(', '));
    }
    const url = `http://${req.headers.host ?? `127.0.0.1:${port}`}${req.url ?? '/'}`;
    const method = req.method ?? 'GET';
    const body = method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks);
    const out = await handler(new Request(url, { method, headers, body }));
    res.statusCode = out.status;
    out.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve(() => new Promise<void>((r) => server.close(() => r())));
    });
  });
}
