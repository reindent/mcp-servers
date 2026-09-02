import { fetchJson } from '../shared/http.js';
import { TtlCache } from '../shared/cache.js';
import { ToolError } from '../shared/errors.js';
import { score } from '../shared/search.js';

/**
 * Data adapter over the Reindent skills library.
 *
 * DRIFT IS IMPOSSIBLE BY CONSTRUCTION, which was the requirement: skills.reindent.com
 * is github.com/reindent/skills served through GitHub Pages, so this server reads the
 * SAME repository content over raw.githubusercontent.com rather than keeping its own
 * copy. There is nothing to re-sync and nothing that can fall behind the site.
 *
 * raw.githubusercontent.com is used in preference to api.github.com deliberately: the
 * API imposes 60 requests/hour unauthenticated, which would make the server fail in a
 * way that looks like a bug. Raw content has no such limit and needs no credential —
 * a public repo read with no token is the least-privilege posture.
 */
const REPO = process.env.SKILLS_REPO ?? 'reindent/skills';
const REF = process.env.SKILLS_REF ?? 'main';
const RAW = `https://raw.githubusercontent.com/${REPO}/${REF}`;
const SITE = 'https://skills.reindent.com';
const UA = 'reindent-mcp-skills/0.1 (+https://skills.reindent.com)';

type MarketplacePlugin = {
  name: string;
  source: string;
  description: string;
  homepage?: string;
  category?: string;
  tags?: string[];
};
type Marketplace = {
  name: string;
  description: string;
  owner?: { name?: string; url?: string };
  plugins: MarketplacePlugin[];
};
type PluginManifest = {
  name: string;
  displayName?: string;
  version?: string;
  description?: string;
  author?: { name?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
};

const marketplaceCache = new TtlCache<Marketplace>(15 * 60_000, 2);
const manifestCache = new TtlCache<PluginManifest>(15 * 60_000, 20);
const docCache = new TtlCache<string>(15 * 60_000, 20);

async function marketplace(): Promise<Marketplace> {
  return marketplaceCache.get('m', () =>
    fetchJson<Marketplace>(`${RAW}/.claude-plugin/marketplace.json`, { userAgent: UA }),
  );
}

async function manifest(name: string): Promise<PluginManifest> {
  return manifestCache.get(name, () =>
    fetchJson<PluginManifest>(`${RAW}/${name}/.claude-plugin/plugin.json`, { userAgent: UA }),
  );
}

/** SKILL.md is markdown, not JSON, so it is fetched as text through the same guards. */
async function skillDoc(name: string): Promise<string> {
  return docCache.get(name, async () => {
    const res = await fetch(`${RAW}/${name}/SKILL.md`, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    if (!res || !res.ok) {
      throw new ToolError('upstream_unavailable', `Could not read SKILL.md for "${name}".`);
    }
    const text = await res.text();
    if (text.length > 512_000) {
      throw new ToolError('upstream_unavailable', 'Skill document too large.');
    }
    return text;
  });
}

async function requirePlugin(name: string): Promise<MarketplacePlugin> {
  const m = await marketplace();
  const found = m.plugins.find((p) => p.name === name);
  if (!found) {
    throw new ToolError('not_found', `No skill named "${name}".`, {
      available: m.plugins.map((p) => p.name),
    });
  }
  return found;
}

export async function listSkills() {
  const m = await marketplace();
  return {
    library: m.name,
    description: m.description,
    site: SITE,
    repository: `https://github.com/${REPO}`,
    total: m.plugins.length,
    skills: m.plugins.map((p) => ({
      slug: p.name,
      description: p.description,
      category: p.category,
      tags: p.tags ?? [],
      page: p.homepage ?? `${SITE}/${p.name}`,
    })),
  };
}

export async function searchSkills(args: { query: string }) {
  const m = await marketplace();
  const results = [];

  for (const p of m.plugins) {
    // The full skill document is searched too, not just its blurb — with three skills
    // this is cheap, and it is what lets a problem statement find the right skill.
    const doc = await skillDoc(p.name).catch(() => '');
    const s = score(args.query, [
      { text: p.name, weight: 10 },
      { text: p.description, weight: 4 },
      { text: (p.tags ?? []).join(' '), weight: 6 },
      { text: p.category ?? '', weight: 3 },
      { text: doc, weight: 1 },
    ]);
    if (s === null) continue;
    results.push({
      slug: p.name,
      description: p.description,
      category: p.category,
      tags: p.tags ?? [],
      page: p.homepage ?? `${SITE}/${p.name}`,
      score: Math.round(s),
    });
  }

  results.sort((a, b) => b.score - a.score);
  return { query: args.query, matches: results.length, skills: results };
}

export async function getSkill(name: string) {
  const plugin = await requirePlugin(name);
  const [meta, doc] = await Promise.all([
    manifest(name).catch(() => ({}) as PluginManifest),
    skillDoc(name),
  ]);
  return {
    slug: plugin.name,
    displayName: meta.displayName ?? plugin.name,
    version: meta.version,
    description: plugin.description,
    category: plugin.category,
    tags: plugin.tags ?? [],
    keywords: meta.keywords ?? [],
    license: meta.license,
    author: meta.author,
    page: plugin.homepage ?? `${SITE}/${plugin.name}`,
    repository: meta.repository ?? `https://github.com/${REPO}`,
    document: doc,
  };
}

/**
 * Install steps are taken from the library's own README, not composed from memory —
 * a wrong install command is worse than no tool at all.
 */
export async function installInstructions(name: string) {
  const plugin = await requirePlugin(name);
  const needsNpm = plugin.name === 'browser';
  return {
    slug: plugin.name,
    claudeCode: {
      steps: [
        'Add the marketplace once:',
        '/plugin marketplace add reindent/skills',
        `Then install this skill:`,
        `/plugin install ${plugin.name}@reindent`,
      ],
      snippet: `/plugin marketplace add reindent/skills\n/plugin install ${plugin.name}@reindent`,
      loadsAs: `${plugin.name}:${plugin.name}`,
    },
    plainSkills: {
      note: 'If you prefer plain skills rather than Claude Code plugins:',
      snippet: `npx skills add ${REPO}`,
    },
    postInstall: needsNpm
      ? "The browser skill needs `npm install` once inside its folder (it pulls chrome-remote-interface)."
      : null,
    page: plugin.homepage ?? `${SITE}/${plugin.name}`,
  };
}
