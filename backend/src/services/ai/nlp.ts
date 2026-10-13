/**
 * Dependency-free NLP toolkit used by search, deflection, duplicate detection,
 * language detection and the offline fallbacks of every AI feature.
 * Pure functions only, so it is fully unit-testable and has no I/O.
 */

const STOP: Record<string, string[]> = {
  en: "a an and are as at be but by for from has have i in is it its my of on or our that the their this to was we were will with you your not can cant cannot do does did im me been being they them he she fix issue problem help please unable urgent again since time working work say says get got just now today morning".split(" "),
  es: "el la los las un una unos unas y o de del en que es por con para no se su al lo como mas pero mi tu yo he ha muy sin sobre".split(" "),
  fr: "le la les un une des et ou de du en que est pour avec ne pas se sa son au ce mon ma je il elle nous vous sur dans par plus".split(" "),
  de: "der die das ein eine und oder von zu mit ist nicht ich mein sie es den dem im auf für als auch wie bei nach noch".split(" "),
  pt: "o a os as um uma e ou de do da em que é por com para não se seu ao como mais mas meu eu ele ela nós muito sem sobre".split(" "),
  it: "il lo la i gli le un una e o di del in che è per con non si suo al come più ma mio io lui lei noi molto senza".split(" "),
};
const ALL_STOP = new Set(Object.values(STOP).flat());

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

function stem(w: string): string {
  if (!/^[a-z]+$/.test(w) || w.length < 5) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("ing") && w.length > 6) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 5) return w.slice(0, -2);
  if (w.endsWith("es") && w.length > 5) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Unicode-aware tokenizer: words for alphabetic scripts, character bigrams for CJK. */
export function tokenize(text: string, opts: { keepStop?: boolean } = {}): string[] {
  const out: string[] = [];
  const parts = text.toLowerCase().split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
  for (const p of parts) {
    if (CJK.test(p)) {
      const chars = Array.from(p);
      if (chars.length === 1) out.push(p);
      for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1]);
      continue;
    }
    if (!opts.keepStop && (p.length < 2 || ALL_STOP.has(p))) continue;
    out.push(stem(p));
  }
  return out;
}

// ---------------------------------------------------------------- BM25 search
export interface IndexDoc {
  id: string;
  title: string;
  keywords?: string[];
  body: string;
}
export interface SearchHit {
  id: string;
  score: number;
  /** Fraction (0-1) of distinct query terms found in the document. */
  coverage: number;
}

export class BM25Index {
  private docs: { id: string; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avgLen = 1;
  constructor(docs: IndexDoc[], private k1 = 1.4, private b = 0.75) {
    for (const d of docs) {
      const tf = new Map<string, number>();
      // Field boosts: title x3, keywords x2, body x1.
      const add = (tokens: string[], w: number) => tokens.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + w));
      add(tokenize(d.title), 3);
      add(tokenize((d.keywords ?? []).join(" ")), 2);
      add(tokenize(d.body), 1);
      const len = Array.from(tf.values()).reduce((a, c) => a + c, 0);
      this.docs.push({ id: d.id, tf, len });
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgLen = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.docs.length);
  }
  get size() {
    return this.docs.length;
  }
  search(query: string, limit = 5): SearchHit[] {
    const q = Array.from(new Set(tokenize(query)));
    if (!q.length) return [];
    const N = this.docs.length;
    const hits: SearchHit[] = [];
    for (const d of this.docs) {
      let score = 0;
      let matched = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        matched++;
        const n = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / this.avgLen)));
      }
      if (score > 0) hits.push({ id: d.id, score, coverage: matched / q.length });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

// ------------------------------------------------------------ text similarity
/** Cosine similarity over term-frequency vectors, 0-1. Used for duplicate detection. */
export function textSimilarity(a: string, b: string): number {
  const va = new Map<string, number>();
  const vb = new Map<string, number>();
  tokenize(a).forEach((t) => va.set(t, (va.get(t) ?? 0) + 1));
  tokenize(b).forEach((t) => vb.set(t, (vb.get(t) ?? 0) + 1));
  let dot = 0, na = 0, nb = 0;
  for (const [t, x] of va) { na += x * x; const y = vb.get(t); if (y) dot += x * y; }
  for (const y of vb.values()) nb += y * y;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ---------------------------------------------------------- language detection
const SCRIPTS: [string, RegExp][] = [
  ["ar", /[\u0600-\u06ff]/g], ["hi", /[\u0900-\u097f]/g], ["ja", /[\u3040-\u30ff]/g], ["ko", /[\uac00-\ud7af]/g],
  ["zh", /[\u4e00-\u9fff]/g], ["ru", /[\u0400-\u04ff]/g], ["th", /[\u0e00-\u0e7f]/g], ["he", /[\u0590-\u05ff]/g],
];

export function detectLanguage(text: string): { lang: string; confidence: number } {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters === 0) return { lang: "en", confidence: 0 };
  let best = { lang: "", n: 0 };
  for (const [lang, re] of SCRIPTS) {
    const n = (text.match(re) ?? []).length;
    if (n > best.n) best = { lang, n };
  }
  if (best.n / letters > 0.3) return { lang: best.lang, confidence: Math.min(1, best.n / letters + 0.2) };
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  let top = { lang: "en", hits: 0 };
  let second = 0;
  for (const [lang, list] of Object.entries(STOP)) {
    const set = new Set(list);
    const hits = words.filter((w) => set.has(w)).length;
    if (hits > top.hits) { second = top.hits; top = { lang, hits }; } else if (hits > second) second = hits;
  }
  if (top.hits === 0) return { lang: "en", confidence: 0.2 };
  return { lang: top.lang, confidence: Math.min(1, 0.5 + (top.hits - second) / Math.max(4, words.length)) };
}

// -------------------------------------------------------------------- sentiment
const NEG: Record<string, string[]> = {
  en: "unacceptable terrible awful angry frustrated frustrating useless worst broken again still waiting ridiculous furious annoyed disappointed hate failed failing never nothing worse".split(" "),
  es: "inaceptable terrible horrible enfadado frustrado inútil peor roto otra vez todavía esperando ridículo furioso molesto nunca nada".split(" "),
  fr: "inacceptable terrible horrible énervé frustré inutile pire cassé encore toujours attends ridicule furieux jamais rien".split(" "),
  de: "inakzeptabel schrecklich furchtbar wütend frustriert nutzlos schlimmste kaputt wieder immer noch warte lächerlich nie nichts".split(" "),
};
const POS: Record<string, string[]> = {
  en: "thanks thank great awesome perfect love excellent helpful appreciate resolved wonderful fantastic good".split(" "),
  es: "gracias genial perfecto excelente útil agradezco resuelto maravilloso bueno".split(" "),
  fr: "merci super parfait excellent utile résolu génial bon".split(" "),
  de: "danke großartig perfekt ausgezeichnet hilfreich gelöst wunderbar gut".split(" "),
};

/** Lexicon + typography sentiment, -1 (very negative) … +1. Live-LLM mode overrides this. */
export function analyzeSentiment(text: string, lang = "en"): { score: number; label: "negative" | "neutral" | "positive" } {
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const neg = new Set(NEG[lang] ?? NEG.en), pos = new Set(POS[lang] ?? POS.en);
  const n = words.filter((w) => neg.has(w)).length;
  const p = words.filter((w) => pos.has(w)).length;
  let score = (p - n) / (p + n + 2);
  const letters = text.replace(/[^\p{L}]/gu, "");
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  if (letters.length > 20 && upper / letters.length > 0.5) score -= 0.25;
  if (/!{2,}/.test(text)) score -= 0.15;
  score = Math.max(-1, Math.min(1, score));
  return { score: +score.toFixed(2), label: score < -0.2 ? "negative" : score > 0.2 ? "positive" : "neutral" };
}

// ---------------------------------------------------------------- summarisation
/** Extractive summary: highest-scoring sentences by term frequency, kept in original order. */
export function summarizeExtractive(text: string, maxSentences = 2): string {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?。！？]+[.!?。！？]?/g)?.map((s) => s.trim()).filter((s) => s.length > 3) ?? [];
  if (sentences.length <= maxSentences) return sentences.join(" ");
  const tf = new Map<string, number>();
  tokenize(text).forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
  const scored = sentences.map((s, i) => {
    const toks = tokenize(s);
    const sc = toks.reduce((a, t) => a + (tf.get(t) ?? 0), 0) / Math.max(4, toks.length) + (i === 0 ? 0.5 : 0);
    return { s, i, sc };
  });
  return scored.sort((a, b) => b.sc - a.sc).slice(0, maxSentences).sort((a, b) => a.i - b.i).map((x) => x.s).join(" ");
}

// --------------------------------------------------------------------- privacy
/** Strip obvious personal data before text leaves the trust boundary to an LLM. */
export function redactPII(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[card]")
    .replace(/(?<!\w)\+?\d[\d\s().-]{8,}\d(?!\w)/g, "[phone]");
}
