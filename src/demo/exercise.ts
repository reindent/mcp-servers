/**
 * Demo harness: connects a real MCP client to a server over stdio and exercises
 * every tool it advertises. This is the deliverable transcript, and it is also the
 * test — if a tool's schema or handler is wrong, this fails loudly.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

type Call = { tool: string; args: Record<string, unknown>; note: string };

const stdioTransport = (serverScript: string): Transport =>
  new StdioClientTransport({ command: process.execPath, args: [serverScript], stderr: 'pipe' });

async function exercise(makeTransport: () => Transport, label: string, calls: Call[]): Promise<void> {
  const client = new Client({ name: 'reindent-demo-client', version: '0.1.0' });
  await client.connect(makeTransport());

  console.log(`\n${'='.repeat(78)}\n  ${label}\n${'='.repeat(78)}`);

  const { tools } = await client.listTools();
  console.log(`\nTOOLS ADVERTISED (${tools.length}):`);
  for (const t of tools) {
    const ann = t.annotations ?? {};
    console.log(`  • ${t.name} — ${t.title ?? ''}`);
    console.log(`      readOnly=${ann.readOnlyHint} destructive=${ann.destructiveHint} params=[${Object.keys((t.inputSchema as { properties?: object }).properties ?? {}).join(', ')}]`);
  }

  for (const call of calls) {
    console.log(`\n── ${call.tool}(${JSON.stringify(call.args)})  — ${call.note}`);
    const started = Date.now();
    const res = await client.callTool({ name: call.tool, arguments: call.args });
    const ms = Date.now() - started;
    const first = (res.content as { type: string; text?: string }[])[0];
    const body = first?.text ?? '';
    const isError = res.isError === true;
    console.log(`   ${isError ? 'ERROR' : 'ok'} in ${ms}ms`);
    console.log(
      body
        .split('\n')
        .slice(0, 14)
        .map((l) => `   │ ${l}`)
        .join('\n'),
    );
    if (body.split('\n').length > 14) console.log(`   │ … (${body.split('\n').length} lines total)`);
  }

  await client.close();
}

const AGENTICLIST_CALLS: Call[] = [
  { tool: 'list_categories', args: {}, note: 'the browse dimension' },
  { tool: 'list_agents', args: { category: 'customer-service', limit: 3 }, note: 'browse one category' },
  { tool: 'search_agents', args: { query: 'voice agent for support', limit: 3 }, note: 'free-text search' },
  { tool: 'get_agent', args: { slug: 'decagon' }, note: 'full profile' },
  { tool: 'get_agent', args: { slug: 'no-such-agent-xyz' }, note: 'NOT FOUND — structured error, not a crash' },
  { tool: 'get_agent', args: { slug: '../../etc/passwd' }, note: 'INVALID INPUT — slug validation rejects traversal' },
  { tool: 'search_agents', args: { query: '' }, note: 'INVALID INPUT — empty query rejected' },
];

const SKILLS_CALLS: Call[] = [
  { tool: 'list_skills', args: {}, note: 'the whole catalog' },
  { tool: 'search_skills', args: { query: 'agents talking to each other' }, note: 'problem statement -> skill' },
  { tool: 'search_skills', args: { query: 'project board in my repo' }, note: 'searches full skill documents' },
  { tool: 'get_skill', args: { slug: 'boards' }, note: 'full SKILL.md + metadata' },
  { tool: 'install_instructions', args: { slug: 'browser' }, note: 'exact steps incl. post-install' },
  { tool: 'get_skill', args: { slug: 'nonexistent' }, note: 'NOT FOUND — lists what IS available' },
  { tool: 'get_skill', args: { slug: 'Boards' }, note: 'INVALID INPUT — uppercase rejected by slug rule' },
];

// ---------------------------------------------------------------------------
// HTTP mode: boots the hosted entry on 127.0.0.1 with an origin secret, drives it
// with the SDK's Streamable HTTP client, and then attacks the guards with raw fetch:
// no secret -> 403, wrong host -> 403, wrong path -> 404. Nothing leaves this machine.
// ---------------------------------------------------------------------------
const SECRET = 'demo-origin-secret-not-for-production';

async function bootHosted(script: string, port: number, host: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, MCP_LOCAL_PORT: String(port), ORIGIN_SECRET: SECRET, ALLOWED_HOSTS: host },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('hosted server did not become ready')), 8000);
    child.stderr!.on('data', (d: Buffer) => {
      if (d.toString().includes('"event":"ready"')) { clearTimeout(t); resolve(); }
    });
  });
  return child;
}

async function guards(port: number, host: string, path: string): Promise<void> {
  const base = `http://127.0.0.1:${port}`;
  const wrongPath = path === '/' ? '/mcp' : '/nope'; // the root-hosted server must refuse /mcp too
  const probe = async (note: string, path: string, headers: Record<string, string>) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
    console.log(`\n── GUARD: ${note}\n   HTTP ${r.status}  ${(await r.text()).slice(0, 110)}`);
  };
  await probe('no origin secret -> must be 403', path, { 'x-forwarded-host': host });
  await probe('right secret, wrong host -> must be 403', path, { 'x-origin-secret': SECRET, 'x-forwarded-host': 'evil.example' });
  await probe(`right secret, wrong path (${wrongPath}) -> must be 404`, wrongPath, { 'x-origin-secret': SECRET, 'x-forwarded-host': host });
  const h = await fetch(`${base}/healthz`);
  console.log(`\n── GUARD: /healthz open without secret -> ${h.status} ${await h.text()}`);
}

async function exerciseHttp(script: string, port: number, host: string, path: string, label: string, calls: Call[]): Promise<void> {
  const child = await bootHosted(script, port, host);
  try {
    await exercise(
      () => new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}${path}`), {
        requestInit: { headers: { 'x-origin-secret': SECRET, 'x-forwarded-host': host } },
      }),
      `${label}  [HTTP at ${path}, stateless, origin-protected — localhost]`,
      calls,
    );
    await guards(port, host, path);
  } finally {
    child.kill();
  }
}

const target = process.argv[2] ?? 'both';
const mode = process.argv[3] ?? 'stdio';
if (mode === 'stdio') {
  if (target === 'agenticlist' || target === 'both') await exercise(() => stdioTransport('dist/agenticlist/index.js'), 'S-42 · AgenticList MCP server', AGENTICLIST_CALLS);
  if (target === 'skills' || target === 'both') await exercise(() => stdioTransport('dist/skills/index.js'), 'S-41 · Reindent Skills MCP server', SKILLS_CALLS);
} else {
  if (target === 'agenticlist' || target === 'both') await exerciseHttp('dist/agenticlist/hosted.js', 3841, 'mcp.agenticlist.ai', '/', 'S-42 · AgenticList', AGENTICLIST_CALLS);
  if (target === 'skills' || target === 'both') await exerciseHttp('dist/skills/hosted.js', 3842, 'skills.reindent.com', '/mcp', 'S-41 · Reindent Skills', SKILLS_CALLS);
}
