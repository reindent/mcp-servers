/**
 * Structured audit logging.
 *
 * Every tool call gets one JSON line on stderr. stderr, not stdout, is deliberate:
 * on a stdio MCP server stdout IS the protocol channel, so a stray console.log
 * corrupts the JSON-RPC stream and breaks the session. This is the single most
 * common way to break an MCP server, so it is enforced here rather than trusted.
 *
 * What is logged: tool, outcome, duration, a redacted parameter summary. What is
 * never logged: raw free-text query strings beyond a length cap, and anything a
 * caller could use to identify another caller. There is no PII in either catalog.
 */
export type LogEvent = {
  ts: string;
  server: string;
  tool: string;
  outcome: 'ok' | 'error' | 'rate_limited';
  ms: number;
  code?: string;
  params?: Record<string, unknown>;
  cache?: 'hit' | 'miss';
};

const MAX_VALUE = 80;

/** Truncate and stringify so a hostile parameter cannot bloat or forge a log line. */
export function redact(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (typeof v === 'string') out[k] = v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else out[k] = `[${typeof v}]`;
  }
  return out;
}

export function log(event: LogEvent): void {
  process.stderr.write(`${JSON.stringify(event)}\n`);
}
