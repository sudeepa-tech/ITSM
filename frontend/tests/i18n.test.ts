import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/locales/en";

const langs = ["es", "fr", "de", "pt", "hi", "ar", "ja"] as const;
const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();

describe.each(langs)("locale %s", (l) => {
  it("only defines known keys and keeps {placeholders} identical to English", async () => {
    const d = (await import(`../src/i18n/locales/${l}.ts`)).default as Record<string, string>;
    for (const [k, v] of Object.entries(d)) {
      expect(k in en, `unknown key ${k}`).toBe(true);
      expect(vars(v), `${l}:${k}`).toBe(vars((en as Record<string, string>)[k]));
      expect(v.trim().length).toBeGreaterThan(0);
    }
    expect(Object.keys(d).length).toBeGreaterThan(150);
  });
  it("translates the statuses and priorities distinctly", async () => {
    const d = (await import(`../src/i18n/locales/${l}.ts`)).default as Record<string, string>;
    expect(new Set(["P1", "P2", "P3", "P4"].map((p) => d[`pri.${p}`])).size).toBe(4);
    expect(d["status.RESOLVED"]).not.toBe(d["status.CLOSED"]);
  });
});
