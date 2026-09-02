/**
 * One error shape for every tool, on both servers.
 *
 * MCP tool errors are returned as content with `isError: true` rather than thrown:
 * a thrown exception becomes a protocol-level failure the calling agent cannot reason
 * about, while a structured error is something it can read and act on.
 */
export class ToolError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'invalid_input'
      | 'rate_limited'
      | 'upstream_unavailable'
      | 'internal',
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

/** Never leak an upstream stack trace or internal URL to a public caller. */
export function toPublicError(err: unknown): { code: string; message: string } {
  if (err instanceof ToolError) return { code: err.code, message: err.message };
  return { code: 'internal', message: 'The server could not complete that request.' };
}
