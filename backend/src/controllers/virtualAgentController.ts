import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import { groundedAnswer } from "../services/ai/copilot";
import { searchKb } from "../services/ai/knowledge";
import { detectLanguage } from "../services/ai/nlp";
import { getSetting } from "../services/settings";
import { createTicket } from "../services/ticketService";

interface Msg { role: "user" | "assistant"; content: string; sources?: { id: string; title: string }[]; offerTicket?: boolean; provider?: string; at: string }

const NO_ANSWER: Record<string, string> = {
  en: "I couldn't find a reliable answer in our knowledge base. I can raise a ticket for you with this conversation attached.",
  es: "No encontré una respuesta fiable en nuestra base de conocimiento. Puedo crear un ticket con esta conversación adjunta.",
  fr: "Je n'ai pas trouvé de réponse fiable dans notre base de connaissances. Je peux créer un ticket avec cette conversation en pièce jointe.",
  de: "Ich habe in unserer Wissensdatenbank keine verlässliche Antwort gefunden. Ich kann ein Ticket mit diesem Gespräch für Sie erstellen.",
  pt: "Não encontrei uma resposta confiável na nossa base de conhecimento. Posso abrir um chamado com esta conversa anexada.",
  hi: "मुझे हमारे नॉलेज बेस में भरोसेमंद उत्तर नहीं मिला। मैं इस बातचीत के साथ आपके लिए टिकट बना सकता हूँ।",
  ar: "لم أجد إجابة موثوقة في قاعدة المعرفة لدينا. يمكنني إنشاء تذكرة لك مع إرفاق هذه المحادثة.",
  ja: "ナレッジベースに信頼できる回答が見つかりませんでした。この会話を添えてチケットを作成できます。",
};

export async function chat(req: Request, res: Response) {
  const b = z.object({ sessionId: z.string().optional(), message: z.string().trim().min(1).max(2000) }).parse(req.body);
  const userId = req.user!.sub;
  let session = b.sessionId ? await prisma.virtualAgentSession.findFirst({ where: { id: b.sessionId, userId } }) : null;
  if (b.sessionId && !session) throw new ApiError(404, "Conversation not found");
  const history = ((session?.messages as unknown as Msg[]) ?? []).slice(-20);
  const now = () => new Date().toISOString();

  const userMsg: Msg = { role: "user", content: b.message, at: now() };
  // Use the last couple of user turns so follow-ups ("and on Mac?") keep their context.
  const query = [...history.filter((m) => m.role === "user").slice(-2).map((m) => m.content), b.message].join(" ");
  const settings = await getSetting("ai");
  const hits = (await searchKb(query, 4)).filter((h) => h.coverage >= settings.deflectionMinCoverage);
  const ans = await groundedAnswer(query, hits, { userId });
  const lang = detectLanguage(b.message).lang;

  const has = !!ans.value.answer;
  const reply: Msg = {
    role: "assistant", at: now(), provider: ans.provider, offerTicket: !has,
    content: has ? ans.value.answer : NO_ANSWER[lang] ?? NO_ANSWER.en,
    sources: has ? hits.filter((h) => ans.value.sourceIds.includes(h.article.id)).map((h) => ({ id: h.article.id, title: h.article.title })) : [],
  };
  const messages = [...history, userMsg, reply] as unknown as object[];
  session = session
    ? await prisma.virtualAgentSession.update({ where: { id: session.id }, data: { messages } })
    : await prisma.virtualAgentSession.create({ data: { userId, messages } });
  res.json({ sessionId: session.id, message: reply });
}

export async function resolve(req: Request, res: Response) {
  const { resolved } = z.object({ resolved: z.boolean() }).parse(req.body);
  await prisma.virtualAgentSession.updateMany({ where: { id: req.params.id, userId: req.user!.sub }, data: { resolved } });
  res.status(204).end();
}

/** Hand-off: turn the conversation into a real ticket with the transcript attached. */
export async function toTicket(req: Request, res: Response) {
  const s = await prisma.virtualAgentSession.findFirst({ where: { id: req.params.id, userId: req.user!.sub } });
  if (!s) throw new ApiError(404, "Conversation not found");
  const msgs = s.messages as unknown as Msg[];
  const firstUser = msgs.find((m) => m.role === "user")?.content ?? "Help request";
  const transcript = msgs.map((m) => `${m.role === "user" ? "Requester" : "Virtual agent"}: ${m.content}`).join("\n\n");
  const { ticket } = await createTicket({
    subject: firstUser.slice(0, 120), description: `Raised from virtual-agent chat.\n\n${transcript}`.slice(0, 9_500),
    requesterId: req.user!.sub, actor: req.user!.email, actorIsStaff: false, channel: "VIRTUAL_AGENT",
  });
  await prisma.virtualAgentSession.update({ where: { id: s.id }, data: { ticketId: ticket.id, resolved: false } });
  res.status(201).json({ id: ticket.id, ticketNumber: ticket.ticketNumber });
}
