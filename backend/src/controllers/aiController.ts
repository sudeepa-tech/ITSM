import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import { isStaff } from "../middleware/rbac";
import { classifyTicket } from "../services/ai/classifier";
import * as copilot from "../services/ai/copilot";
import { detectClusters, findDuplicates } from "../services/ai/duplicates";
import { searchKb } from "../services/ai/knowledge";
import { textSimilarity } from "../services/ai/nlp";
import { getSetting } from "../services/settings";
import { assertCanView } from "../services/ticketService";
import { CLOSED_STATUSES } from "../services/sla/slaService";

const text = z.object({ subject: z.string().trim().min(3).max(200), description: z.string().trim().min(3).max(10_000) });

/** POST /ai/analyze-ticket — pre-submission preview: classification, duplicate warning, known-issue signal. */
export async function analyzeTicket(req: Request, res: Response) {
  const b = text.parse(req.body);
  const staff = isStaff(req);
  const [classification, dups, settings] = await Promise.all([
    classifyTicket(b.subject, b.description, { userId: req.user!.sub }),
    findDuplicates(b.subject, b.description, { requesterId: req.user!.sub, ownOnly: !staff }),
    getSetting("ai"),
  ]);
  // Requesters get a count only ("14 people reported this"), never other people's ticket titles.
  let knownIssue: { count: number } | null = null;
  if (!staff) {
    const recent = await prisma.ticket.findMany({ where: { createdAt: { gte: new Date(Date.now() - settings.clusterWindowMins * 4 * 60_000) }, status: { notIn: CLOSED_STATUSES as any } }, select: { subject: true, description: true }, take: 200 });
    const n = recent.filter((r) => textSimilarity(`${b.subject} ${b.description}`, `${r.subject} ${r.description}`) >= 0.35).length;
    if (n >= 2) knownIssue = { count: n };
  }
  res.json({ classification, duplicates: dups, knownIssue });
}

/** POST /ai/deflect — self-service answers grounded in the knowledge base (never invented). */
export async function deflect(req: Request, res: Response) {
  const b = text.parse(req.body);
  const settings = await getSetting("ai");
  const query = `${b.subject} ${b.description}`;
  const hits = (await searchKb(query, 5)).filter((h) => h.coverage >= settings.deflectionMinCoverage);
  if (!hits.length) return res.json({ articles: [], answer: null, provider: "rules", eventId: null });
  const ans = await copilot.groundedAnswer(query, hits, { userId: req.user!.sub });
  const recent = await prisma.deflectionEvent.findFirst({ where: { userId: req.user!.sub, query, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
  const event = recent ?? (await prisma.deflectionEvent.create({ data: { userId: req.user!.sub, query, articleIds: hits.map((h) => h.article.id) } }));
  res.json({
    articles: hits.map((h) => ({ id: h.article.id, title: h.article.title, excerpt: h.excerpt, coverage: +h.coverage.toFixed(2), url: h.article.url })),
    answer: ans.value.answer || null, provider: ans.provider, eventId: event.id,
  });
}

export async function deflectionOutcome(req: Request, res: Response) {
  const { outcome } = z.object({ outcome: z.enum(["SOLVED", "TICKET_CREATED"]) }).parse(req.body);
  await prisma.deflectionEvent.updateMany({ where: { id: req.params.id, userId: req.user!.sub }, data: { outcome } });
  res.status(204).end();
}

// ------------------------------------------------------------ per-ticket copilot
async function loadForAI(id: string, req: Request): Promise<copilot.TicketForAI & { resolutionNotes: string | null; categoryId: string | null }> {
  const t = await prisma.ticket.findUnique({
    where: { id },
    include: { requester: { select: { name: true } }, category: true, comments: { include: { author: { select: { name: true, role: true } } }, orderBy: { createdAt: "asc" }, take: 40 } },
  });
  if (!t) throw new ApiError(404, "Ticket not found");
  assertCanView(t, req.user!);
  return {
    id: t.id, ticketNumber: t.ticketNumber, subject: t.subject, description: t.description, language: t.language, status: t.status,
    category: t.category?.name, subcategory: t.category?.subcategory, requesterName: t.requester.name, resolutionNotes: t.resolutionNotes, categoryId: t.categoryId,
    comments: t.comments.map((c) => ({ author: c.author.name, body: c.body, internal: c.internal, staff: c.author.role !== "END_USER" })),
  };
}

/** GET /ai/tickets/:id/insights — troubleshooting steps, grounded KB docs and similar past tickets. */
export async function insights(req: Request, res: Response) {
  const t = await loadForAI(req.params.id, req);
  const found = await searchKb(`${t.subject} ${t.description}`, 5);
  // Relevance floor: weak keyword coincidences are worse than no suggestion.
  const docs = found.filter((d) => d.coverage >= 0.2 && d.score >= (found[0]?.score ?? 0) * 0.4);
  const [steps, pool] = await Promise.all([
    copilot.troubleshootingSteps(t.subcategory ?? "", t, docs, { userId: req.user!.sub }),
    prisma.ticket.findMany({ where: { id: { not: t.id } }, select: { id: true, ticketNumber: true, subject: true, description: true, status: true, resolutionNotes: true }, orderBy: { createdAt: "desc" }, take: 400 }),
  ]);
  const similar = pool
    .map((p) => ({ id: p.id, ticketNumber: p.ticketNumber, subject: p.subject, status: p.status, resolutionNotes: p.resolutionNotes, similarity: +textSimilarity(`${t.subject} ${t.description}`, `${p.subject} ${p.description}`).toFixed(2) }))
    .filter((p) => p.similarity >= 0.25)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);
  res.json({
    steps: steps.value, stepsProvider: steps.provider,
    docs: docs.map((d) => ({ id: d.article.id, title: d.article.title, url: d.article.url, excerpt: d.excerpt, relevance: +d.coverage.toFixed(2), updatedAt: d.article.updatedAt })),
    similar,
  });
}

export async function summary(req: Request, res: Response) {
  const t = await loadForAI(req.params.id, req);
  const s = await copilot.summarizeTicket(t, { userId: req.user!.sub });
  await prisma.ticket.update({ where: { id: t.id }, data: { aiSummary: s.value, aiSummaryAt: new Date(), aiSummaryProvider: s.provider } });
  res.json({ summary: s.value, provider: s.provider });
}

export async function replyDraft(req: Request, res: Response) {
  const { tone } = z.object({ tone: z.enum(["empathetic", "concise", "formal"]).default("empathetic") }).parse(req.body ?? {});
  const t = await loadForAI(req.params.id, req);
  const docs = await searchKb(`${t.subject} ${t.description}`, 3);
  const steps = await copilot.troubleshootingSteps(t.subcategory ?? "", t, docs, { userId: req.user!.sub });
  const agent = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub }, select: { name: true } });
  const d = await copilot.draftReply(t, { tone, steps: steps.value, docs, agentName: agent.name }, { userId: req.user!.sub });
  res.json({ draft: d.value, provider: d.provider, language: t.language });
}

export async function resolutionNotes(req: Request, res: Response) {
  const t = await loadForAI(req.params.id, req);
  const r = await copilot.resolutionNotes(t, { userId: req.user!.sub });
  res.json({ notes: r.value, provider: r.provider });
}

export async function kbDraft(req: Request, res: Response) {
  const t = await loadForAI(req.params.id, req);
  const r = await copilot.draftKbArticle(t, { userId: req.user!.sub });
  res.json({ ...r.value, provider: r.provider, sourceTicketId: t.id });
}

export async function translate(req: Request, res: Response) {
  const b = z.object({ text: z.string().min(1).max(8000), target: z.string().min(2).max(5) }).parse(req.body);
  const r = await copilot.translateText(b.text, b.target, { userId: req.user!.sub });
  if (!r) throw new ApiError(503, "Translation needs a live AI provider. Set ANTHROPIC_API_KEY to enable it.", "AI_UNAVAILABLE");
  res.json({ translation: r.value, provider: r.provider });
}

export async function feedback(req: Request, res: Response) {
  const b = z.object({ ticketId: z.string().optional(), feature: z.string().max(40), verdict: z.enum(["UP", "DOWN"]), comment: z.string().max(500).optional() }).parse(req.body);
  await prisma.aIFeedback.create({ data: { userId: req.user!.sub, ...b } });
  res.status(204).end();
}

export async function clusters(_req: Request, res: Response) {
  res.json(await detectClusters());
}
