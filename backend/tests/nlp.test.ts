import { describe, expect, it } from "vitest";
import { BM25Index, analyzeSentiment, detectLanguage, redactPII, summarizeExtractive, textSimilarity, tokenize } from "../src/services/ai/nlp";
import { stripQuoted } from "../src/utils/email";

describe("tokenize", () => {
  it("drops stop words and stems plurals", () => {
    expect(tokenize("The printers are offline")).toEqual(["printer", "offline"]);
  });
  it("makes bigrams for CJK text", () => {
    expect(tokenize("印刷機")).toEqual(["印刷", "刷機"]);
  });
});

describe("BM25Index", () => {
  const idx = new BM25Index([
    { id: "vpn", title: "Fix VPN authentication failed", keywords: ["vpn", "mfa"], body: "Refresh your token and update the VPN client." },
    { id: "print", title: "Printer offline", keywords: ["printer"], body: "Restart the print spooler and re-add the printer." },
    { id: "mail", title: "Outlook not syncing", keywords: ["outlook"], body: "Create a new Outlook profile." },
  ]);
  it("ranks the relevant article first", () => {
    expect(idx.search("my vpn login fails authentication")[0].id).toBe("vpn");
    expect(idx.search("printer not working")[0].id).toBe("print");
  });
  it("returns nothing for unrelated queries", () => {
    expect(idx.search("quantum chromodynamics")).toEqual([]);
  });
  it("reports coverage of the query terms", () => {
    const hit = idx.search("printer offline")[0];
    expect(hit.coverage).toBe(1);
  });
});

describe("textSimilarity", () => {
  it("is high for near duplicates and low for unrelated text", () => {
    expect(textSimilarity("VPN authentication failed since this morning", "VPN authentication failed again this morning")).toBeGreaterThan(0.6);
    expect(textSimilarity("VPN authentication failed", "Printer out of toner")).toBe(0);
  });
});

describe("detectLanguage", () => {
  it.each([
    ["My laptop will not connect to the company network and I cannot work", "en"],
    ["No puedo iniciar sesión porque olvidé mi contraseña y la cuenta está bloqueada", "es"],
    ["Bonjour, l'imprimante du deuxième étage est hors ligne depuis ce matin", "fr"],
    ["Guten Tag, die VPN-Verbindung bricht im Homeoffice ständig ab und ich kann nicht arbeiten", "de"],
    ["मेरा लैपटॉप चालू नहीं हो रहा है", "hi"],
    ["لا أستطيع الاتصال بالشبكة", "ar"],
    ["プリンターが動きません", "ja"],
  ])("%s -> %s", (text, lang) => {
    expect(detectLanguage(text).lang).toBe(lang);
  });
});

describe("analyzeSentiment", () => {
  it("flags angry, shouting text as negative", () => {
    expect(analyzeSentiment("THIS IS UNACCEPTABLE!!! Still waiting, everything is broken again").label).toBe("negative");
  });
  it("flags thanks as positive and plain text as neutral", () => {
    expect(analyzeSentiment("Thanks, that was perfect and very helpful").label).toBe("positive");
    expect(analyzeSentiment("Please reset my password").label).toBe("neutral");
  });
});

describe("summarizeExtractive", () => {
  it("keeps the requested number of sentences in original order", () => {
    const s = summarizeExtractive("VPN fails on login. It started this morning. The weather is nice. VPN login error persists for VPN users.", 2);
    expect(s.split(/(?<=\.)\s/).length).toBe(2);
  });
});

describe("redactPII", () => {
  it("masks emails, cards and phone numbers", () => {
    const r = redactPII("Mail jane.doe@corp.com, call +1 (415) 555-0134, card 4111 1111 1111 1111");
    expect(r).not.toMatch(/jane|555|4111/);
    expect(r).toContain("[email]");
  });
});

describe("stripQuoted", () => {
  it("removes quoted reply history", () => {
    expect(stripQuoted("Thanks, fixed!\n\nOn Mon, Jan 1, 2026 Support wrote:\n> old text")).toBe("Thanks, fixed!");
    expect(stripQuoted("Works now\n> earlier\n> lines")).toBe("Works now");
  });
});

describe("natural-language deflection regression", () => {
  const idx = new BM25Index([
    { id: "vpn", title: "Fix VPN 'authentication failed' errors", keywords: ["vpn", "authentication", "mfa"], body: "Refresh your token and update the VPN client." },
    { id: "lap", title: "Laptop does not start after a Windows update", keywords: ["laptop", "boot"], body: "Hold the power button for fifteen seconds." },
  ]);
  it("finds the right article for a long, chatty description", () => {
    const hit = idx.search("My VPN says authentication failed. I cannot connect to the VPN from home since this morning, it just says authentication failed.")[0];
    expect(hit.id).toBe("vpn");
    expect(hit.coverage).toBeGreaterThanOrEqual(0.3);
  });
  it("does not let generic words like 'fix' create a match", () => {
    expect(idx.search("please fix this issue, it is a problem").length).toBe(0);
  });
});
