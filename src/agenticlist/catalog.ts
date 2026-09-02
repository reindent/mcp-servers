import { fetchJson } from '../shared/http.js';
import { TtlCache } from '../shared/cache.js';
import { ToolError } from '../shared/errors.js';
import { score } from '../shared/search.js';

/**
 * Data adapter over the public AgenticList API.
 *
 * We read the SAME public API a browser reads — no database credentials, no private
 * endpoint, no write path. That is the least-privilege posture: this server cannot do
 * anything a visitor to agenticlist.ai could not already do, so a compromise of it
 * yields nothing.
 */
const BASE = process.env.AGENTICLIST_BASE_URL ?? 'https://agenticlist.ai';
const UA = 'reindent-mcp-agenticlist/0.1 (+https://agenticlist.ai)';

export type Agent = {
  slug: string;
  name: string;
  tagline?: string;
  description: string;
  longDescription?: string;
  url: string;
  categories?: string[];
  tags?: string[];
  pricing?: string;
  priceFrom?: number;
  hasFreeTier?: boolean;
  pricingNotes?: string;
  plans?: { name: string; price: number; period?: string; features?: string[] }[];
  features?: { title: string; description: string }[];
  useCases?: string[];
  integrations?: string[];
  platforms?: string[];
  modelsSupported?: string[];
  openSource?: boolean;
  company?: Record<string, unknown>;
  awards?: string[];
  faq?: { q: string; a: string }[];
  imageUrl?: string;
  githubUrl?: string;
  xUrl?: string;
  linkedinUrl?: string;
  docsUrl?: string;
};

type AgentsResponse = { agents: Agent[]; pagination: { total: number } };
type Category = { slug: string; name: string; description?: string; agentCount?: number };

// The catalog changes rarely (a curated directory), so a 10-minute TTL is generous
// to the upstream without ever serving meaningfully stale data.
const agentsCache = new TtlCache<AgentsResponse>(10 * 60_000, 50);
const categoriesCache = new TtlCache<Category[]>(30 * 60_000, 5);

/**
 * The upstream clamps a page to 12 items regardless of the `limit` asked for
 * (measured: `?limit=500` returns 12, with pagination.pages = 21 for 251 agents),
 * so the full catalog has to be walked. Pages are fetched in small concurrent
 * batches to stay polite to the upstream, and the whole walk happens at most once
 * per TTL because TtlCache single-flights concurrent callers onto one promise.
 */
const PAGE_CONCURRENCY = 4;

async function allAgents(): Promise<AgentsResponse> {
  return agentsCache.get('all', async () => {
    const first = await fetchJson<AgentsResponse & { pagination: { pages: number } }>(
      `${BASE}/api/agents?page=1`,
      { userAgent: UA },
    );
    const pages = Math.min(first.pagination.pages ?? 1, 60); // hard ceiling: never walk unbounded
    const rest: Agent[] = [];

    for (let start = 2; start <= pages; start += PAGE_CONCURRENCY) {
      const batch = [];
      for (let p = start; p < start + PAGE_CONCURRENCY && p <= pages; p++) {
        batch.push(
          fetchJson<AgentsResponse>(`${BASE}/api/agents?page=${p}`, { userAgent: UA }),
        );
      }
      const settled = await Promise.all(batch);
      for (const r of settled) rest.push(...r.agents);
    }

    return {
      agents: [...first.agents, ...rest],
      pagination: { total: first.pagination.total },
    };
  });
}

export async function listAgents(args: { limit: number; offset: number; category?: string }) {
  const { agents, pagination } = await allAgents();
  const filtered = args.category
    ? agents.filter((a) => (a.categories ?? []).includes(args.category as string))
    : agents;
  const page = filtered.slice(args.offset, args.offset + args.limit);
  return {
    total: args.category ? filtered.length : pagination.total,
    returned: page.length,
    offset: args.offset,
    agents: page.map(summarize),
  };
}

export async function searchAgents(args: { query: string; limit: number }) {
  const { agents } = await allAgents();

  const scored = agents
    .map((a) => {
      const s = score(args.query, [
        { text: a.name, weight: 10 },
        { text: a.tagline ?? '', weight: 5 },
        { text: (a.tags ?? []).join(' '), weight: 4 },
        { text: (a.categories ?? []).join(' '), weight: 3 },
        { text: (a.useCases ?? []).join(' '), weight: 2 },
        { text: a.description, weight: 1 },
      ]);
      return s === null ? null : { agent: a, score: s };
    })
    .filter((x): x is { agent: Agent; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, args.limit);

  return {
    query: args.query,
    matches: scored.length,
    agents: scored.map((s) => summarize(s.agent)),
  };
}

export async function getAgent(slugValue: string) {
  const { agents } = await allAgents();
  const found = agents.find((a) => a.slug === slugValue);
  if (!found) {
    throw new ToolError('not_found', `No agent with slug "${slugValue}".`, {
      hint: 'Use search_agents or list_agents to find valid slugs.',
    });
  }
  return { ...found, page: `${BASE}/agent/${found.slug}` };
}

export async function listCategories() {
  const cats = await categoriesCache.get('all', () =>
    fetchJson<Category[]>(`${BASE}/api/agents/categories`, { userAgent: UA }),
  );
  return {
    total: cats.length,
    categories: cats.map((c) => ({
      slug: c.slug,
      name: c.name,
      agentCount: c.agentCount ?? 0,
      description: c.description,
    })),
  };
}

/** The list shape: enough for an agent to choose, without dumping 39 fields per row. */
function summarize(a: Agent) {
  return {
    slug: a.slug,
    name: a.name,
    tagline: a.tagline ?? a.description.slice(0, 140),
    categories: a.categories ?? [],
    pricing: a.pricing ?? 'N/A',
    hasFreeTier: a.hasFreeTier ?? false,
    openSource: a.openSource ?? false,
    url: a.url,
    page: `${BASE}/agent/${a.slug}`,
  };
}
