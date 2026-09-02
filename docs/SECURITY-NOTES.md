# Security notes — Reindent's public MCP servers

Two read-only MCP servers: `reindent-skills` (S-41) and `agenticlist` (S-42).
This states what the protections **are**. It does not imply any that do not exist.

## Threat model, honestly

Both servers expose **public catalogs**: skills.reindent.com and agenticlist.ai. Every
record they return is already readable by anyone with a browser. There is therefore no
confidentiality boundary to defend and **no authentication story** — that is a property
of the data, not an oversight. What genuinely needs defending is **integrity of the
process** (the server must not become a way to reach something else) and **availability**
(it must not become an amplifier or a cost sink).

## What is implemented

| Control | Implementation | Where |
|---|---|---|
| **Read-only by construction** | The only registration path is `registerReadTool`. There is no write tool, and no code path that issues a mutating upstream request. Every tool is stamped `readOnlyHint: true`, `destructiveHint: false`, so a client can see it before calling. | `src/shared/server.ts` |
| **Input validation on every parameter** | Zod schemas on all tools, enforced by the SDK before a handler runs. Slugs must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`; queries are 1–200 chars; limits are ints 1–50; offsets are bounded. | `src/shared/validate.ts` |
| **Path traversal / SSRF guard** | Slugs are interpolated into upstream URLs, so the slug pattern **is** the guard. `../../etc/passwd` is rejected before any fetch. Verified in the demo transcript. | `src/shared/validate.ts` |
| **Rate limiting** | `RateLimiter` interface; sliding window in memory by default. | `src/shared/ratelimit.ts` |
| **Request timeouts** | Every upstream fetch has a hard 8s timeout. A hanging tool call otherwise hangs the calling agent's whole turn. | `src/shared/http.ts` |
| **Response size bound** | Upstream responses are capped (4 MB catalog JSON, 512 KB per skill doc). We proxy upstreams we do not control in-process; an unbounded read is a memory DoS. | `src/shared/http.ts`, `src/skills/library.ts` |
| **Caching + single flight** | TTL cache in front of every upstream read; concurrent cold calls collapse onto one request instead of N. Protects the upstream as much as us. | `src/shared/cache.ts` |
| **Audit logging** | One structured JSON line per call: tool, outcome, duration, error code, redacted params. Written to **stderr** — stdout is the JSON-RPC channel on a stdio server, so logging there corrupts the session. | `src/shared/logging.ts` |
| **Error containment** | Handlers throw typed `ToolError`s; anything else becomes a generic `internal` message. Upstream URLs, stack traces and internal detail never reach a caller. Errors return as `isError` content, not thrown exceptions. | `src/shared/errors.ts` |
| **Least privilege** | Neither server holds a credential. Both read the same public endpoints a browser reads: agenticlist.ai's public API, and raw.githubusercontent.com for the skills repo. Compromising either yields nothing a visitor could not already fetch. | `src/*/catalog.ts`, `library.ts` |
| **No PII** | Neither catalog contains personal data. Nothing about a caller is stored — the rate limiter holds timestamps only, in memory. | — |

## Stated limitations

1. **In-memory rate limiting is per-process.** With N concurrent instances the effective
   limit is N × the configured limit. Correct for a stdio server (one process per client);
   **not a real ceiling for a hosted deployment**. For hosting: put the blunt ceiling at
   the edge (API Gateway usage plan or WAF rate rule) and, for per-client fairness,
   implement `RateLimiter` against a shared store (DynamoDB conditional counter). Nothing
   above the interface changes.
2. **No authentication or per-caller identity.** Deliberate — the data is public. If a
   hosted endpoint ever needs quotas per consumer, that requires an identity mechanism
   that does not exist today.
3. **Availability depends on the upstreams.** If agenticlist.ai or GitHub raw is down,
   tools return `upstream_unavailable` rather than stale data beyond the cache TTL.
4. **The skills catalog is read live from GitHub.** That makes site/catalog drift
   impossible by construction, and it means GitHub is a runtime dependency.
5. **Transport.** Everything above is verified over **stdio** AND over the hosted HTTP path on
   localhost (`docs/DEMO-TRANSCRIPT-HTTP.txt`). The hosted path adds: a stateless per-request
   transport (no sessions, correct on Lambda), an **origin secret** (`x-origin-secret`,
   constant-time compared) that the Cloudflare Worker adds and the function rejects without —
   so the raw Function URL is useless to anyone who finds it and the edge rate limits cannot
   be bypassed — and a **host allowlist** on `x-forwarded-host`. Guards proven by hostile
   requests: no secret → 403, wrong host → 403, wrong path → 404, `/healthz` open and inert.
   Edge rate limiting (Cloudflare WAF) and TLS are the edge's job; the deployment itself is documented separately.

## Verified, not asserted

`docs/DEMO-TRANSCRIPT.txt` is the output of a real MCP client connecting to both servers
over stdio and exercising every tool, including the failure paths: unknown slug →
structured `not_found`; `../../etc/passwd` → rejected by validation; empty query →
rejected; uppercase slug → rejected. Reproduce with `npm run build && node dist/demo/exercise.js both`.
