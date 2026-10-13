import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import { groundedAnswer } from "../services/ai/copilot";
import { findDuplicates, knownIssueCount } from "../services/ai/duplicates";
import { searchKb } from "../services/ai/knowledge";
import { detectLanguage } from "../services/ai/nlp";
import { getSetting } from "../services/settings";
import { createTicket } from "../services/ticketService";

type Notice = { kind: "duplicate"; id: string; ticketNumber: string; subject: string } | { kind: "known"; count: number };
interface Msg {
  role: "user" | "assistant"; content: string; at: string;
  sources?: { id: string; title: string }[]; articles?: { id: string; title: string; excerpt: string }[]; notices?: Notice[];
  offerTicket?: boolean; provider?: string; eventId?: string;
}

const NO_ANSWER: Record<string, string> = {
  en: "I couldn't find a reliable answer in our knowledge base. Add any details you have (error messages, when it started), then I can raise a ticket for you with this conversation attached.",
  es: "No encontré una respuesta fiable en nuestra base de conocimiento. Añada los detalles que tenga y puedo crear un ticket con esta conversación adjunta.",
  fr: "Je n'ai pas trouvé de réponse fiable dans notre base de connaissances. Ajoutez les détails dont vous disposez, puis je crée un ticket avec cette conversation en pièce jointe.",
  de: "Ich habe in unserer Wissensdatenbank keine verlässliche Antwort gefunden. Ergänzen Sie Details, dann erstelle ich ein Ticket mit diesem Gespräch.",
  pt: "Não encontrei uma resposta confiável na nossa base de conhecimento. Adicione os detalhes que tiver e posso abrir um chamado com esta conversa anexada.",
  hi: "मुझे हमारे नॉलेज बेस में भरोसेमंद उत्तर नहीं मिला। आपके पास जो विवरण हैं जोड़ें, फिर मैं इस बातचीत के साथ टिकट बना सकता हूँ।",
  ar: "لم أجد إجابة موثوقة في قاعدة المعرفة لدينا. أضف ما لديك من تفاصيل ويمكنني إنشاء تذكرة مع إرفاق هذه المحادثة.",
  ja: "ナレッジベースに信頼できる回答が見つかりませんでした。詳細を追加していただければ、この会話を添えてチケットを作成できます。",
};

const userTurns = (m: Msg[]) => m.filter((x) => x.role === "user").map((x) => x.content);
const subjectOf = (first: string) => {
  const s = (first.split(/\n|(?<=[.!?。])\s/)[0] ?? first).trim().replace(/[.!?。]+$/, "").slice(0, 120);
  return s.length >= 3 ? s : "Help request";
};

export async function chat(req: Request, res: Response) {
  const b = z.object({ sessionId: z.string().optional(), message: z.string().trim().min(1).max(2000) }).parse(req.body);
  const userId = req.user!.sub;
  let session = b.sessionId ? await prisma.virtualAgentSession.findFirst({ where: { id: b.sessionId, userId } }) : null;
  if (b.sessionId && !session) throw new ApiError(404, "Conversation not found");
  if (session?.ticketId) throw new ApiError(409, "A ticket was already created from this conversation. Start a new one.");
  const history = ((session?.messages as unknown as Msg[]) ?? []).slice(-20);
  const now = () => new Date().toISOString();

  const turns = userTurns(history);
  // Last couple of user turns keep follow-ups ("and on Mac?") in context.
  const query = [...turns.slice(-2), b.message].join(" ");
  const settings = await getSetting("ai");
  const hits = (await searchKb(query, 4)).filter((h) => h.coverage >= settings.deflectionMinCoverage);
  const ans = await groundedAnswer(query, hits, { userId });
  const lang = detectLanguage(b.message).lang;

  // Duplicate / known-issue signals are cheap text matches (no model call) and shown once per conversation.
  const notices: Notice[] = [];
  if (!history.some((m) => m.notices?.length)) {
    const all = [...turns, b.message].join("\n");
    const [dups, known] = await Promise.all([findDuplicates(all, "", { requesterId: userId, ownOnly: true }), knownIssueCount(all)]);
    if (dups[0]) notices.push({ kind: "duplicate", id: dups[0].id, ticketNumber: dups[0].ticketNumber, subject: dups[0].subject });
    if (known >= 2) notices.push({ kind: "known", count: known });
  }

  // Self-service outcome tracking: one deflection event per conversation.
  let eventId = [...history].reverse().find((m) => m.eventId)?.eventId;
  if (hits.length && !eventId) eventId = (await prisma.deflectionEvent.create({ data: { userId, query, articleIds: hits.map((h) => h.article.id) } })).id;

  const has = !!ans.value.answer;
  const reply: Msg = {
    role: "assistant", at: now(), provider: ans.provider, offerTicket: !has, notices, eventId: has ? eventId : undefined,
    content: has ? ans.value.answer : NO_ANSWER[lang] ?? NO_ANSWER.en,
    sources: has ? hits.filter((h) => ans.value.sourceIds.includes(h.article.id)).map((h) => ({ id: h.article.id, title: h.article.title })) : [],
    articles: hits.slice(0, 3).map((h) => ({ id: h.article.id, title: h.article.title, excerpt: h.excerpt })),
  };
  const messages = [...history, { role: "user", content: b.message, at: now() }, reply] as unknown as object[];
  session = session
    ? await prisma.virtualAgentSession.update({ where: { id: session.id }, data: { messages } })
    : await prisma.virtualAgentSession.create({ data: { userId, messages } });
  res.json({ sessionId: session.id, message: reply });
}

export async function resolve(req: Request, res: Response) {
  const { resolved } = z.object({ resolved: z.boolean() }).parse(req.body);
  const s = await prisma.virtualAgentSession.findFirst({ where: { id: req.params.id, userId: req.user!.sub } });
  if (!s) throw new ApiError(404, "Conversation not found");
  await prisma.virtualAgentSession.update({ where: { id: s.id }, data: { resolved } });
  const ev = [...(s.messages as unknown as Msg[])].reverse().find((m) => m.eventId)?.eventId;
  if (ev && resolved) await prisma.deflectionEvent.updateMany({ where: { id: ev, userId: req.user!.sub }, data: { outcome: "SOLVED" } });
  res.status(204).end();
}

/** The only way an employee raises a ticket: the requester's own words drive classification, the whole chat is attached for the agent. */
export async function toTicket(req: Request, res: Response) {
  const s = await prisma.virtualAgentSession.findFirst({ where: { id: req.params.id, userId: req.user!.sub } });
  if (!s) throw new ApiError(404, "Conversation not found");
  if (s.ticketId) throw new ApiError(409, "A ticket was already created from this conversation.");
  const msgs = s.messages as unknown as Msg[];
  const mine = userTurns(msgs);
  if (!mine.length) throw new ApiError(400, "Describe the problem first.");
  const description = mine.join("\n\n").slice(0, 9_500);
  const { ticket } = await createTicket({ subject: subjectOf(mine[0]), description, aiText: description, requesterId: req.user!.sub, actor: req.user!.email, actorIsStaff: false, channel: "VIRTUAL_AGENT" });

  const transcript = msgs.map((m) => `${m.role === "user" ? "Requester" : "Assistant"}: ${m.content}${m.articles?.length ? `\n  (suggested: ${m.articles.map((a) => a.title).join("; ")})` : ""}`).join("\n\n");
  await prisma.ticketComment.create({ data: { ticketId: ticket.id, authorId: req.user!.sub, internal: true, aiAssisted: true, body: `Assistant conversation before this ticket was raised:\n\n${transcript}`.slice(0, 9_500) } });
  await prisma.virtualAgentSession.update({ where: { id: s.id }, data: { ticketId: ticket.id, resolved: false } });
  const ev = [...msgs].reverse().find((m) => m.eventId)?.eventId;
  if (ev) await prisma.deflectionEvent.updateMany({ where: { id: ev, userId: req.user!.sub, outcome: "SHOWN" }, data: { outcome: "TICKET_CREATED" } });
  res.status(201).json({ id: ticket.id, ticketNumber: ticket.ticketNumber, team: ticket.assignee?.team ?? null, category: ticket.category?.name ?? null });
}
