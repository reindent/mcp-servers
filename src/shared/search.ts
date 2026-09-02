/**
 * Shared free-text matching for both catalogs.
 *
 * WHY THIS EXISTS: the first implementation required EVERY query term to appear
 * (an AND over terms). That works for keyword queries and fails exactly the case
 * the tools advertise — a natural-language problem statement. "agents talking to
 * each other" returned nothing, because "to", "each" and "other" are not in any
 * skill document. The demo harness caught it; it would have shipped as "search is
 * broken" otherwise.
 *
 * The rule now: drop stopwords, require at least one meaningful term to match, and
 * RANK by how much matched. Recall first, ordering does the rest — an agent reads a
 * ranked list, so a weak extra result costs far less than a missing right answer.
 */
const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','but','by','can','do','does','for','from','how','i',
  'in','is','it','me','my','of','on','or','that','the','their','them','then','there','these',
  'they','this','to','use','using','want','was','we','what','when','where','which','who',
  'will','with','you','your','each','other','need','make','get','have','has','into','about',
]);

export function terms(query: string): string[] {
  const all = query
    .toLowerCase()
    .split(/[^a-z0-9+#.-]+/)
    .filter(Boolean);
  const meaningful = all.filter((t) => t.length > 2 && !STOPWORDS.has(t));
  // If the query is nothing but stopwords ("how do I do that"), fall back to the raw
  // words rather than matching everything — an empty term list must not mean "match all".
  return meaningful.length > 0 ? meaningful : all;
}

export type Field = { text: string; weight: number };

/**
 * Score one candidate. Returns null when nothing matched, so callers filter cleanly.
 * A whole-phrase hit is worth more than the sum of its words, which is what makes
 * an exact product name rank above an incidental mention.
 */
export function score(query: string, fields: Field[]): number | null {
  const q = query.toLowerCase().trim();
  const ts = terms(query);
  let total = 0;
  let matchedAny = false;

  for (const field of fields) {
    const hay = field.text.toLowerCase();
    if (q.length > 2 && hay.includes(q)) {
      total += field.weight * 3; // whole-phrase match
      matchedAny = true;
    }
    for (const t of ts) {
      if (hay.includes(t)) {
        total += field.weight;
        matchedAny = true;
      }
    }
  }
  return matchedAny ? total : null;
}
