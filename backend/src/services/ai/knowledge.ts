import { prisma } from "../../config/db";
import { BM25Index, tokenize, SearchHit } from "./nlp";

interface KbRow { id: string; title: string; body: string; keywords: string[]; category: string | null; url: string | null; language: string; updatedAt: Date }
let cache: { at: number; index: BM25Index; rows: Map<string, KbRow> } | null = null;
const TTL = 60_000;

export const invalidateKbIndex = () => { cache = null; };

async function getIndex() {
  if (cache && Date.now() - cache.at < TTL) return cache;
  const rows = await prisma.knowledgeArticle.findMany({ where: { status: "PUBLISHED" }, select: { id: true, title: true, body: true, keywords: true, category: true, url: true, language: true, updatedAt: true } });
  cache = { at: Date.now(), index: new BM25Index(rows), rows: new Map(rows.map((r) => [r.id, r])) };
  return cache;
}

/** Best passage (up to ~2 sentences) of an article for a query — extractive, never generated. */
export function excerpt(body: string, query: string, max = 320): string {
  const q = new Set(tokenize(query));
  const sentences = body.replace(/\s+/g, " ").match(/[^.!?。！？]+[.!?。！？]?/g) ?? [body];
  let bestI = 0, best = -1;
  sentences.forEach((s, i) => {
    const score = tokenize(s).filter((t) => q.has(t)).length;
    if (score > best) { best = score; bestI = i; }
  });
  return (sentences[bestI] + (sentences[bestI + 1] ?? "")).trim().slice(0, max);
}

export interface KbResult extends SearchHit {
  article: KbRow;
  excerpt: string;
}

export async function searchKb(query: string, limit = 5): Promise<KbResult[]> {
  const { index, rows } = await getIndex();
  return index.search(query, limit).map((h) => ({ ...h, article: rows.get(h.id)!, excerpt: excerpt(rows.get(h.id)!.body, query) }));
}
