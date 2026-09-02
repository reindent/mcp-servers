# Reindent MCP servers

Two public, read-only [MCP](https://modelcontextprotocol.io) servers, built and run by Reindent:

| Server | Catalog | Endpoint | Tools |
|---|---|---|---|
| `agenticlist` | [agenticlist.ai](https://agenticlist.ai) — a curated directory of AI agents | `https://mcp.agenticlist.ai/` | `list_agents`, `search_agents`, `get_agent`, `list_categories` |
| `reindent-skills` | [skills.reindent.com](https://skills.reindent.com) — the skills the Reindent studio runs on | `https://skills.reindent.com/mcp` | `list_skills`, `search_skills`, `get_skill`, `install_instructions` |

Both are **read-only by construction**: the only way to register a tool in this codebase stamps it
`readOnlyHint: true`, and there is no code path that issues a mutating request. Neither server holds a
credential — each reads the same public data a browser reads.

## Connect

Any MCP client that speaks Streamable HTTP:

```json
{ "mcpServers": {
    "agenticlist": { "url": "https://mcp.agenticlist.ai/" },
    "reindent-skills": { "url": "https://skills.reindent.com/mcp" } } }
```

Or run either locally over stdio:

```
npm ci && npm run build
node dist/agenticlist/index.js     # stdio server
node dist/skills/index.js
```

## See it work

`node dist/demo/exercise.js both` connects a real MCP client to both servers over stdio and exercises
every tool, including the failure paths (unknown slug, path traversal, empty query). `node dist/demo/exercise.js both http`
does the same over the hosted transport on localhost and then attacks the guards with hostile requests.
Transcripts: `docs/DEMO-TRANSCRIPT.txt`, `docs/DEMO-TRANSCRIPT-HTTP.txt`.

## Layout

```
src/shared/       the scaffold both servers reuse — validation, rate limiting, caching,
                  audit logging, error envelopes, stdio + hosted transports
src/agenticlist/  S-42, the AgenticList catalog
src/skills/       S-41, the skills library (reads github.com/reindent/skills, so it cannot drift from the site)
src/demo/         the client harness
docs/             SECURITY-NOTES.md · demo transcripts
```

The hosted transport (`src/shared/hosted.ts`, `src/shared/lambda.ts`) is what the public endpoints
run; the infrastructure that runs it is not part of this repository.

## Security posture

`docs/SECURITY-NOTES.md` states what the protections are — and their limits — without implying any that
do not exist. Short version: zod validation on every parameter (the slug pattern is the traversal/SSRF
guard), edge rate limiting, an origin secret between Cloudflare and AWS so the raw function URLs are
useless, hard upstream timeouts and response-size bounds, structured audit logs, no credentials, no PII.
There is no authentication, because the data is public.

## License

MIT
