/**
 * Tokenizer shared by the in-memory BM25 index, the hash embedder and the SQL keyword query,
 * so every retrieval path sees the same terms.
 */

const STOPWORDS = new Set(
  (
    'a an and are as at be but by can do does for from has have how i if in into is it its me my of on or our ' +
    'should so than that the their them then there these they this to was we what when where which who why will ' +
    'with you your'
  ).split(' ')
);

/** Lower-cases, strips accents, splits on non-alphanumerics, drops stopwords, light plural stemming. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const norm = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/₂/g, '2')
    .toLowerCase();
  for (const raw of norm.split(/[^a-z0-9]+/)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    const t = raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw;
    out.push(t);
  }
  return out;
}

/** Rough token count (≈ 4/3 tokens per word) used only for chunk sizing. */
export function approxTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil((words * 4) / 3);
}
