#!/usr/bin/env node
import { createServer, type ServerHandle } from '../shared/server.js';
import { slug, query, limit, cursor } from '../shared/validate.js';
import * as catalog from './catalog.js';

/**
 * S-42 — the AgenticList MCP server.
 *
 * Read-only. Four tools, scoped to the catalog's own shape: browse, search, fetch one,
 * and the browse dimension (categories). No write path exists in v1; a gated
 * submit_listing is a separate conversation, not a hidden capability.
 */
export function build(): ServerHandle {
  const server = createServer({
  name: 'agenticlist',
  version: '0.1.0',
  instructions: [
    'AgenticList is a curated directory of AI agents, frameworks and tools at agenticlist.ai.',
    'Use search_agents when the user describes a need ("an agent that answers support tickets");',
    'use list_agents with a category to browse; use get_agent for the full profile of one entry',
    'before recommending it. All tools are read-only.',
  ].join(' '),
});

server.registerReadTool({
  name: 'list_agents',
  title: 'List agents',
  description:
    'Browse the AgenticList catalog, optionally filtered to one category. Returns a summary per agent (slug, name, tagline, categories, pricing, links). Use get_agent for full detail.',
  inputSchema: {
    category: slug.optional().describe('Category slug, e.g. "customer-service". Omit for all.'),
    limit: limit.describe('How many agents to return (1-50, default 20).'),
    offset: cursor.describe('Offset for paging through results.'),
  },
  handler: async (args: { category?: string; limit: number; offset: number }) =>
    catalog.listAgents(args),
});

server.registerReadTool({
  name: 'search_agents',
  title: 'Search agents',
  description:
    'Search the catalog by free text across names, taglines, descriptions, tags, categories and use cases. Every term must match. Results are ranked with name matches first.',
  inputSchema: {
    query: query.describe('What to look for, e.g. "customer support voice agent".'),
    limit: limit.describe('Maximum results (1-50, default 20).'),
  },
  handler: async (args: { query: string; limit: number }) => catalog.searchAgents(args),
});

server.registerReadTool({
  name: 'get_agent',
  title: 'Get one agent',
  description:
    'Full profile for a single agent: long description, key features, use cases, pricing plans and notes, integrations, platforms, supported models, company facts, FAQ and links.',
  inputSchema: {
    slug: slug.describe('The agent\'s slug, as returned by list_agents or search_agents.'),
  },
  handler: async (args: { slug: string }) => catalog.getAgent(args.slug),
});

server.registerReadTool({
  name: 'list_categories',
  title: 'List categories',
  description:
    'The catalog\'s browse dimension: every category with its slug, name and how many agents it holds. Use a returned slug with list_agents.',
  inputSchema: {},
  handler: async () => catalog.listCategories(),
});

  return server;
}

// Entry point when run directly as a stdio server; importing `build` has no side effects.
if (process.argv[1] && /index\.js$/.test(process.argv[1]) && process.env.MCP_TRANSPORT !== 'http') {
  build().serveStdio().catch((err: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ ts: new Date().toISOString(), server: 'agenticlist', event: 'fatal', message: String(err) })}\n`,
  );
  process.exit(1);
});
}
