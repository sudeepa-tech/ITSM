import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import { isStaff } from "../middleware/rbac";
import { invalidateKbIndex, searchKb } from "../services/ai/knowledge";
import { audit } from "../services/audit";
import { pageArgs, pageQuery } from "../utils/pagination";

const articleSchema = z.object({
  title: z.string().trim().min(3).max(160), body: z.string().trim().min(10).max(50_000), category: z.string().max(60).nullish(),
  keywords: z.array(z.string().max(40)).max(20).default([]), language: z.string().max(5).default("en"),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("PUBLISHED"), url: z.string().url().nullish(), sourceTicketId: z.string().nullish(),
});

const select = { id: true, title: true, category: true, keywords: true, language: true, status: true, views: true, helpful: true, notHelpful: true, updatedAt: true, url: true } as const;

export async function list(req: Request, res: Response) {
  const q = pageQuery.extend({ q: z.string().max(120).optional(), category: z.string().optional(), status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional() }).parse(req.query);
  const staff = isStaff(req);
  if (q.q) {
    const hits = await searchKb(q.q, q.pageSize);
    return res.json({ items: hits.map((h) => ({ ...h.article, body: undefined, status: "PUBLISHED", excerpt: h.excerpt })), total: hits.length, page: 1, pageSize: q.pageSize });
  }
  const where: Prisma.KnowledgeArticleWhereInput = { status: staff ? q.status : "PUBLISHED", category: q.category };
  const [total, items] = await Promise.all([prisma.knowledgeArticle.count({ where }), prisma.knowledgeArticle.findMany({ where, select, orderBy: { updatedAt: "desc" }, ...pageArgs(q) })]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
}

export async function categories(_req: Request, res: Response) {
  const rows = await prisma.knowledgeArticle.groupBy({ by: ["category"], where: { status: "PUBLISHED", category: { not: null } }, _count: true });
  res.json(rows.map((r) => ({ name: r.category, count: r._count })));
}

export async function get(req: Request, res: Response) {
  const a = await prisma.knowledgeArticle.findUnique({ where: { id: req.params.id } });
  if (!a || (a.status !== "PUBLISHED" && !isStaff(req))) throw new ApiError(404, "Article not found");
  if (a.status === "PUBLISHED") await prisma.knowledgeArticle.update({ where: { id: a.id }, data: { views: { increment: 1 } } });
  res.json(a);
}

export async function create(req: Request, res: Response) {
  const b = articleSchema.parse(req.body);
  const a = await prisma.knowledgeArticle.create({ data: { ...b, createdById: req.user!.sub } });
  invalidateKbIndex();
  await audit(req, "kb.create", "KnowledgeArticle", a.id, undefined, { title: a.title, status: a.status });
  res.status(201).json(a);
}

export async function update(req: Request, res: Response) {
  const b = articleSchema.partial().parse(req.body);
  const old = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: req.params.id } });
  const a = await prisma.knowledgeArticle.update({ where: { id: old.id }, data: b });
  invalidateKbIndex();
  await audit(req, "kb.update", "KnowledgeArticle", a.id, { title: old.title, status: old.status }, { title: a.title, status: a.status });
  res.json(a);
}

export async function remove(req: Request, res: Response) {
  const a = await prisma.knowledgeArticle.delete({ where: { id: req.params.id } });
  invalidateKbIndex();
  await audit(req, "kb.delete", "KnowledgeArticle", a.id, { title: a.title });
  res.status(204).end();
}

export async function feedback(req: Request, res: Response) {
  const { helpful } = z.object({ helpful: z.boolean() }).parse(req.body);
  await prisma.knowledgeArticle.update({ where: { id: req.params.id }, data: helpful ? { helpful: { increment: 1 } } : { notHelpful: { increment: 1 } } });
  res.status(204).end();
}
