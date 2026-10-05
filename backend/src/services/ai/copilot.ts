/**
 * Agent copilot & self-service generation. Each feature has a live-LLM path and a deterministic
 * offline path, and returns which provider produced the result so the UI can label it honestly.
 */
import { z } from "zod";
import { Provider, INJECTION_GUARD, llmJson, llmText, runAI, untrusted } from "./provider";
import { summarizeExtractive } from "./nlp";
import { KbResult } from "./knowledge";

export interface TicketForAI {
  id?: string;
  ticketNumber: string;
  subject: string;
  description: string;
  language: string;
  category?: string | null;
  subcategory?: string | null;
  status?: string;
  requesterName?: string;
  comments: { author: string; body: string; internal: boolean; staff: boolean }[];
}
interface Ctx { userId?: string }
export interface Generated<T = string> { value: T; provider: Provider }

const transcript = (t: TicketForAI, includeInternal: boolean) =>
  [`Subject: ${t.subject}`, `Description: ${t.description}`, ...t.comments.filter((c) => includeInternal || !c.internal).map((c) => `${c.author}${c.internal ? " (internal note)" : c.staff ? " (agent)" : ""}: ${c.body}`)].join("\n");

const LANG_NAMES: Record<string, string> = { en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", hi: "Hindi", ar: "Arabic", ja: "Japanese", zh: "Chinese", ko: "Korean", ru: "Russian", it: "Italian" };
export const langName = (c: string) => LANG_NAMES[c] ?? c;

// ------------------------------------------------------------------ summary
export async function summarizeTicket(t: TicketForAI, ctx: Ctx = {}): Promise<Generated> {
  return runAI({
    feature: "summary", ticketId: t.id, userId: ctx.userId,
    live: () => llmText({ maxTokens: 300, system: "Summarise this IT ticket for an agent in 2-3 sentences: the problem, what has been tried, and the current state. Plain text, no preamble.", user: untrusted("ticket", transcript(t, true)) }),
    fallback: () => {
      const lastPublic = [...t.comments].reverse().find((c) => !c.internal);
      const base = summarizeExtractive(`${t.subject}. ${t.description}`, 2);
      return lastPublic ? `${base} Latest update (${lastPublic.author}): ${summarizeExtractive(lastPublic.body, 1)}` : base;
    },
  });
}

// -------------------------------------------------------------- reply drafts
export type Tone = "empathetic" | "concise" | "formal";

const TEMPLATES: Record<string, { hi: (n: string) => string; look: string; steps: string; close: string }> = {
  en: { hi: (n) => `Hi ${n},`, look: "Thanks for reaching out — I'm looking into this now.", steps: "Here is what I suggest we try:", close: "Let me know how it goes and I'll follow up right away.\n\nBest regards" },
  es: { hi: (n) => `Hola ${n},`, look: "Gracias por contactarnos; ya estoy revisando su caso.", steps: "Le sugiero probar lo siguiente:", close: "Cuéntenos cómo le va y le responderemos de inmediato.\n\nSaludos cordiales" },
  fr: { hi: (n) => `Bonjour ${n},`, look: "Merci de nous avoir contactés ; je m'occupe de votre demande.", steps: "Je vous propose d'essayer ceci :", close: "Dites-moi si cela fonctionne et je reviens vers vous aussitôt.\n\nCordialement" },
  de: { hi: (n) => `Hallo ${n},`, look: "Danke für Ihre Nachricht – ich kümmere mich gleich darum.", steps: "Ich schlage vor, Folgendes auszuprobieren:", close: "Geben Sie mir bitte Rückmeldung, dann melde ich mich umgehend.\n\nFreundliche Grüße" },
};

export async function draftReply(t: TicketForAI, opts: { tone: Tone; steps: string[]; docs: KbResult[]; agentName: string }, ctx: Ctx = {}): Promise<Generated> {
  return runAI({
    feature: "reply_draft", ticketId: t.id, userId: ctx.userId,
    live: () =>
      llmText({
        maxTokens: 500,
        system:
          `You are an IT service-desk agent named ${opts.agentName}. Draft the next public reply to the requester in ${langName(t.language)}. Tone: ${opts.tone}. ` +
          "Use ONLY the knowledge articles provided for factual guidance; if they are insufficient, ask one clarifying question instead of guessing. " +
          "Do not promise timelines. No subject line. Sign off with the agent's first name.",
        user: untrusted("conversation", transcript(t, false)) + "\n" + untrusted("knowledge", opts.docs.map((d, i) => `[${i + 1}] ${d.article.title}: ${d.article.body.slice(0, 600)}`).join("\n\n") || "(none)") + `\nSuggested steps: ${opts.steps.join("; ")}`,
      }),
    fallback: () => {
      const tpl = TEMPLATES[t.language] ?? TEMPLATES.en;
      const name = (t.requesterName ?? "").split(" ")[0] || "there";
      const list = opts.steps.slice(0, 3).map((s, i) => `${i + 1}. ${s}`).join("\n");
      const body = opts.tone === "concise" ? [tpl.hi(name), list || tpl.look, tpl.close] : [tpl.hi(name), tpl.look, list && `${tpl.steps}\n${list}`, tpl.close];
      return body.filter(Boolean).join("\n\n") + `\n${opts.agentName.split(" ")[0]}`;
    },
  });
}

// --------------------------------------------------------- resolution notes
export async function resolutionNotes(t: TicketForAI, ctx: Ctx = {}): Promise<Generated> {
  return runAI({
    feature: "resolution_notes", ticketId: t.id, userId: ctx.userId,
    live: () => llmText({ maxTokens: 300, system: "Write concise resolution notes for this closed IT ticket: root cause (if known), the fix applied, and how to prevent recurrence. 3-5 short lines, English, plain text.", user: untrusted("ticket", transcript(t, true)) }),
    fallback: () => {
      const agentMsgs = t.comments.filter((c) => c.staff).map((c) => c.body);
      return agentMsgs.length ? `Resolved after: ${summarizeExtractive(agentMsgs.join(" "), 2)}` : `Resolved: ${summarizeExtractive(t.description, 1)}`;
    },
  });
}

// -------------------------------------------------------------- translation
/** Live only — there is no honest offline translation. Returns null when AI is unavailable. */
export async function translateText(text: string, target: string, ctx: Ctx = {}): Promise<Generated | null> {
  const r = await runAI<string | null>({
    feature: "translate", userId: ctx.userId,
    live: () => llmText({ maxTokens: 900, system: `Translate the text into ${langName(target)}. Preserve meaning, tone, names, numbers and formatting. Output only the translation.`, user: untrusted("text", text) }),
    fallback: () => null,
  });
  return r.value === null ? null : { value: r.value, provider: r.provider };
}

// ------------------------------------------------------------ KB generation
const kbDraftSchema = z.object({ title: z.string().min(3).max(140), keywords: z.array(z.string()).max(10), body: z.string().min(20) });
export interface KbDraft { title: string; keywords: string[]; body: string }

export async function draftKbArticle(t: TicketForAI & { resolutionNotes?: string | null }, ctx: Ctx = {}): Promise<Generated<KbDraft>> {
  return runAI<KbDraft>({
    feature: "kb_draft", ticketId: t.id, userId: ctx.userId,
    live: () =>
      llmJson({
        maxTokens: 900,
        system: "Turn this resolved IT ticket into a reusable knowledge-base article. Remove all personal data and ticket-specific details. Title = the user's problem in plain words. Body = symptoms, cause, step-by-step fix (numbered). Shape: {\"title\":string,\"keywords\":string[],\"body\":string}",
        user: untrusted("ticket", transcript(t, true) + (t.resolutionNotes ? `\nResolution notes: ${t.resolutionNotes}` : "")),
      }, kbDraftSchema),
    fallback: () => ({
      title: t.subject,
      keywords: Array.from(new Set([t.category, t.subcategory].filter(Boolean) as string[])),
      body: `Symptoms\n${t.description}\n\nResolution\n${t.resolutionNotes ?? summarizeExtractive(t.comments.filter((c) => c.staff).map((c) => c.body).join(" "), 3)}`,
    }),
  });
}

// ------------------------------------------------------- grounded self-service
export interface GroundedAnswer { answer: string; sourceIds: string[] }

export async function groundedAnswer(question: string, hits: KbResult[], ctx: Ctx = {}): Promise<Generated<GroundedAnswer>> {
  const ids = hits.map((h) => h.article.id);
  return runAI<GroundedAnswer>({
    feature: "self_service_answer", userId: ctx.userId,
    live: async () => {
      if (!hits.length) return null;
      const text = await llmText({
        maxTokens: 500,
        system:
          "Answer the employee's IT question using ONLY the numbered knowledge articles provided, in the language the employee wrote in. " +
          "Cite sources inline as [1], [2]. If the articles do not answer the question, reply exactly: NO_ANSWER. Keep it under 120 words with numbered steps where helpful.",
        user: untrusted("question", question) + "\n" + untrusted("knowledge", hits.map((h, i) => `[${i + 1}] ${h.article.title}\n${h.article.body.slice(0, 900)}`).join("\n\n")),
      });
      if (text.includes("NO_ANSWER")) return { answer: "", sourceIds: [] };
      return { answer: text, sourceIds: ids };
    },
    fallback: () => ({ answer: hits[0] ? hits[0].excerpt : "", sourceIds: hits[0] ? [hits[0].article.id] : [] }),
  });
}

// -------------------------------------------------------- troubleshooting steps
const STEPS: Record<string, string[]> = {
  VPN: ["Verify the user's VPN account status", "Check MFA configuration", "Reset the VPN authentication token", "Validate the VPN client version"],
  Authentication: ["Verify AD account lock status", "Check recent failed login attempts", "Reset password via self-service portal", "Re-enroll the MFA device"],
  Email: ["Check mailbox storage quota", "Verify Outlook connection status", "Test webmail access", "Recreate the Outlook profile"],
  Peripherals: ["Check the device's network/USB connection", "Restart the print spooler service", "Reinstall the driver", "Verify shared device permissions"],
  Cloud: ["Check VM power/network state", "Review the cloud activity log", "Verify firewall/NSG rules", "Confirm recent deployment changes"],
  Application: ["Confirm the application version and licence", "Clear the app cache / reinstall", "Check recent updates or patches", "Reproduce with another user profile"],
  Incident: ["Isolate the affected device from the network", "Preserve logs and screenshots", "Notify the security on-call", "Reset credentials for affected accounts"],
  Permissions: ["Confirm the requester's manager approval", "Check the role/group in the access matrix", "Grant least-privilege access", "Notify the requester and set a review date"],
};

export async function troubleshootingSteps(subcategory: string, t: TicketForAI, docs: KbResult[], ctx: Ctx = {}): Promise<Generated<string[]>> {
  return runAI<string[]>({
    feature: "troubleshooting", ticketId: t.id, userId: ctx.userId,
    live: async () => {
      const r = await llmJson({
        maxTokens: 400,
        system: "Suggest 3-5 concrete diagnostic or fix steps for the agent, ordered from least to most invasive, grounded in the ticket and any knowledge articles. Shape: {\"steps\":string[]}",
        user: untrusted("ticket", transcript(t, true)) + "\n" + untrusted("knowledge", docs.map((d) => d.article.title + ": " + d.article.body.slice(0, 400)).join("\n")),
      }, z.object({ steps: z.array(z.string().max(200)).min(1).max(6) }));
      return r?.steps ?? null;
    },
    fallback: () => STEPS[subcategory] ?? ["Gather more diagnostic detail from the requester", "Check recent related incidents"],
  });
}

export { INJECTION_GUARD };
