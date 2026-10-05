import { z } from "zod";
import { prisma } from "../../config/db";
import { analyzeSentiment, detectLanguage } from "./nlp";
import { llmJson, runAI, untrusted, Provider } from "./provider";

export interface ClassificationResult {
  category: string;
  subcategory: string;
  service: string;
  type: "INCIDENT" | "SERVICE_REQUEST";
  priority: "P1" | "P2" | "P3" | "P4";
  impact: "Low" | "Medium" | "High";
  urgency: "Low" | "Medium" | "High";
  requiredSkills: string[];
  rootCause: string;
  confidence: number; // 0-100
  language: string;
  sentiment: number; // -1..1
  provider: Provider;
}

interface Rule { category: string; subcategory: string; service: string; keywords: string[]; skills: string[]; request?: boolean }

export const CATEGORY_RULES: Rule[] = [
  { category: "Network", subcategory: "VPN", service: "Remote Access", keywords: ["vpn", "remote access", "tunnel", "wifi", "wi-fi", "network", "réseau", "netzwerk"], skills: ["VPN", "Networking"] },
  { category: "Identity", subcategory: "Authentication", service: "Identity & Access", keywords: ["mfa", "password", "login", "log in", "2fa", "locked", "account", "contraseña", "mot de passe", "passwort", "authenticator", "sign in"], skills: ["Active Directory", "Security"] },
  { category: "Collaboration", subcategory: "Email", service: "Email", keywords: ["email", "outlook", "mailbox", "365", "teams", "calendar", "correo", "courriel", "e-mail"], skills: ["Microsoft 365", "Email"] },
  { category: "Hardware", subcategory: "Peripherals", service: "Workplace IT", keywords: ["printer", "print", "laptop", "monitor", "keyboard", "mouse", "screen", "impresora", "imprimante", "drucker", "portátil", "ordinateur"], skills: ["Hardware", "Printer"] },
  { category: "Infrastructure", subcategory: "Cloud", service: "Cloud & Infra", keywords: ["azure", "aws", "server", "database", "cloud", "vm", "kubernetes", "servidor", "serveur"], skills: ["Azure", "Database", "Linux"] },
  { category: "Software", subcategory: "Application", service: "Application Support", keywords: ["install", "software", "application", "app", "license", "licence", "crash", "sap", "update"], skills: ["Software", "Application Support"] },
  { category: "Security", subcategory: "Incident", service: "Security Operations", keywords: ["phishing", "malware", "virus", "ransomware", "suspicious", "breach", "hacked"], skills: ["Security"] },
  { category: "Access", subcategory: "Permissions", service: "Identity & Access", keywords: ["access to", "permission", "grant", "onboarding", "new joiner", "share drive", "request access"], skills: ["Active Directory", "Security"], request: true },
];

const URGENT = ["down", "cannot", "can't", "failure", "urgent", "production", "locked", "crash", "outage", "asap", "critical", "ransomware", "breach", "hacked", "all users", "everyone"];
const REQUEST_HINTS = ["request", "need access", "please provide", "new laptop", "install", "onboarding", "how do i", "grant", "solicitud"];

const NON_SPACED = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const escapeRe = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matchers = new Map<string, RegExp>();

/** Keyword match on word starts (so "app" ≠ "happened"); keywords of 4 letters or fewer must match whole words ("down" ≠ "downloading"). */
function has(text: string, k: string): boolean {
  if (NON_SPACED.test(k)) return text.includes(k);
  let re = matchers.get(k);
  if (!re) {
    const tail = k.length <= 4 ? String.raw`s?(?![\p{L}\p{N}])` : "";
    re = new RegExp(String.raw`(?<![\p{L}\p{N}])` + escapeRe(k) + tail, "u");
    matchers.set(k, re);
  }
  return re.test(text);
}

export function ruleBasedClassify(text: string): Omit<ClassificationResult, "provider"> {
  const t = text.toLowerCase();
  let best = CATEGORY_RULES[0];
  let bestHits = -1;
  for (const rule of CATEGORY_RULES) {
    const hits = rule.keywords.filter((k) => has(t, k)).length;
    if (hits > bestHits) { bestHits = hits; best = rule; }
  }
  const urgencyHits = URGENT.filter((w) => has(t, w)).length;
  const type = best.request || REQUEST_HINTS.some((h) => has(t, h)) ? "SERVICE_REQUEST" : "INCIDENT";
  let priority: ClassificationResult["priority"] = urgencyHits >= 2 ? "P1" : urgencyHits === 1 ? "P2" : "P3";
  if (type === "SERVICE_REQUEST" && priority === "P3") priority = "P4";
  const { lang } = detectLanguage(text);
  const { score } = analyzeSentiment(text, lang);
  return {
    category: best.category, subcategory: best.subcategory, service: best.service, type, priority,
    impact: priority === "P1" ? "High" : priority === "P4" ? "Low" : "Medium",
    urgency: priority === "P1" ? "High" : priority === "P4" ? "Low" : "Medium",
    requiredSkills: best.skills,
    rootCause: `Likely ${best.subcategory.toLowerCase()} issue based on the reported symptoms.`,
    confidence: bestHits <= 0 ? 35 : Math.min(94, 52 + bestHits * 12 + urgencyHits * 4),
    language: lang, sentiment: score,
  };
}

const llmSchema = z.object({
  category: z.string(), subcategory: z.string(), service: z.string(),
  type: z.enum(["INCIDENT", "SERVICE_REQUEST"]),
  priority: z.enum(["P1", "P2", "P3", "P4"]),
  impact: z.enum(["Low", "Medium", "High"]), urgency: z.enum(["Low", "Medium", "High"]),
  requiredSkills: z.array(z.string()).max(6), rootCause: z.string().max(300),
  confidence: z.number().min(0).max(100), language: z.string().max(8), sentiment: z.number().min(-1).max(1),
});

export async function classifyTicket(subject: string, description: string, ctx?: { userId?: string; ticketId?: string }): Promise<ClassificationResult> {
  const text = `${subject}\n${description}`;
  const [cats, skills] = await Promise.all([
    prisma.category.findMany({ where: { active: true }, select: { name: true, subcategory: true }, distinct: ["name"] }),
    prisma.skill.findMany({ select: { name: true } }),
  ]);
  const catNames = Array.from(new Set([...cats.map((c) => c.name), ...CATEGORY_RULES.map((r) => r.category)]));
  const skillNames = skills.map((s) => s.name);

  const { value, provider } = await runAI<Omit<ClassificationResult, "provider">>({
    feature: "classify", ...ctx,
    live: async () => {
      const r = await llmJson({
        system:
          "You triage IT service-desk tickets written in ANY language. " +
          `Choose category from: ${catNames.join(", ")}. Choose requiredSkills only from: ${skillNames.join(", ")}. ` +
          "P1=business-critical outage or security breach affecting many users, P2=major degradation or blocked individual, P3=normal, P4=how-to/low-impact request. " +
          "language is the ISO 639-1 code of the ticket text; sentiment is -1 (angry) to 1 (happy); confidence is your honest 0-100 certainty. " +
          'Shape: {"category","subcategory","service","type":"INCIDENT|SERVICE_REQUEST","priority","impact","urgency","requiredSkills":[],"rootCause","confidence","language","sentiment"}',
        user: untrusted("ticket", text),
      }, llmSchema);
      if (!r) return null;
      // Constrain to the organisation's real taxonomy — the model may not invent categories or skills.
      const fb = ruleBasedClassify(text);
      return { ...r, category: catNames.includes(r.category) ? r.category : fb.category, requiredSkills: r.requiredSkills.filter((s) => skillNames.includes(s)) };
    },
    fallback: () => ruleBasedClassify(text),
  });
  return { ...value, provider };
}
