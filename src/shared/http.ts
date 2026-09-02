import { ToolError } from './errors.js';

/**
 * Outbound HTTP with a hard timeout and a bounded response size.
 *
 * The timeout exists because an MCP tool call that hangs hangs the calling agent's
 * turn. The size cap exists because we are proxying an upstream we do not control
 * within this process; an unbounded read is a memory DoS.
 */
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_BYTES = 4 * 1024 * 1024;

export async function fetchJson<T>(
  url: string,
  opts: { timeoutMs?: number; userAgent: string } = { userAgent: 'reindent-mcp' },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': opts.userAgent },
      redirect: 'follow',
    });
    if (res.status === 404) throw new ToolError('not_found', 'Upstream has no such record.');
    if (!res.ok) {
      throw new ToolError('upstream_unavailable', `Upstream responded ${res.status}.`);
    }
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) {
      throw new ToolError('upstream_unavailable', 'Upstream response too large.');
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) {
      throw new ToolError('upstream_unavailable', 'Upstream response too large.');
    }
    return JSON.parse(text) as T;
  } catch (err) {
    if (err instanceof ToolError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ToolError('upstream_unavailable', 'Upstream timed out.');
    }
    throw new ToolError('upstream_unavailable', 'Could not reach upstream.');
  } finally {
    clearTimeout(timer);
  }
}
