#!/usr/bin/env node
import { createServer, type ServerHandle } from '../shared/server.js';
import { slug, query } from '../shared/validate.js';
import * as library from './library.js';

/**
 * S-41 — the Reindent Skills MCP server.
 *
 * Read-only. Four tools, exactly as briefed: list, search, get, install instructions.
 * No write tools in v1.
 */
export function build(): ServerHandle {
  const server = createServer({
  name: 'reindent-skills',
  version: '0.1.0',
  instructions: [
    'The Reindent skills library (skills.reindent.com): agent skills extracted from daily',
    'production use by an agent workforce. Use search_skills when the user describes a problem',
    '("I want two agents to talk to each other"), list_skills to see the catalog, get_skill to',
    'read a skill in full before recommending it, and install_instructions for the exact steps.',
    'All tools are read-only.',
  ].join(' '),
});

server.registerReadTool({
  name: 'list_skills',
  title: 'List skills',
  description:
    'The full catalog of Reindent skills with a one-line description, category, tags and page link for each. Small by design — read it whole.',
  inputSchema: {},
  handler: async () => library.listSkills(),
});

server.registerReadTool({
  name: 'search_skills',
  title: 'Search skills',
  description:
    'Find skills by free text. Searches names, descriptions, tags AND the full text of each skill document, so a problem statement ("agents talking to each other", "project board in my repo") finds the right skill.',
  inputSchema: {
    query: query.describe('What you are trying to do, or a keyword.'),
  },
  handler: async (args: { query: string }) => library.searchSkills(args),
});

server.registerReadTool({
  name: 'get_skill',
  title: 'Get one skill',
  description:
    'Everything about one skill: metadata (version, license, author, keywords) plus the complete SKILL.md document that tells an agent how to use it.',
  inputSchema: {
    slug: slug.describe('The skill slug, e.g. "boards", "chat" or "browser".'),
  },
  handler: async (args: { slug: string }) => library.getSkill(args.slug),
});

server.registerReadTool({
  name: 'install_instructions',
  title: 'Install instructions',
  description:
    'The exact steps and copy-paste snippet to install a skill, for Claude Code plugins and for plain skills, including any post-install step.',
  inputSchema: {
    slug: slug.describe('The skill slug to install.'),
  },
  handler: async (args: { slug: string }) => library.installInstructions(args.slug),
});

  return server;
}

// Entry point when run directly as a stdio server; importing `build` has no side effects.
if (process.argv[1] && /index\.js$/.test(process.argv[1]) && process.env.MCP_TRANSPORT !== 'http') {
  build().serveStdio().catch((err: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ ts: new Date().toISOString(), server: 'reindent-skills', event: 'fatal', message: String(err) })}\n`,
  );
  process.exit(1);
});
}
