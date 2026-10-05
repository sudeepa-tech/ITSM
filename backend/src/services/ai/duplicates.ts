import { prisma } from "../../config/db";
import { textSimilarity } from "./nlp";
import { getSetting } from "../settings";
import { CLOSED_STATUSES } from "../sla/slaService";

export interface DuplicateMatch { id: string; ticketNumber: string; subject: string; status: string; similarity: number }

/** Likely duplicates among recent open tickets. `ownOnly` restricts to the requester's own tickets so
 * end users never see other people's ticket titles. */
export async function findDuplicates(subject: string, description: string, opts: { requesterId?: string; ownOnly?: boolean; excludeId?: string } = {}): Promise<DuplicateMatch[]> {
  const { duplicateThreshold } = await getSetting("ai");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const candidates = await prisma.ticket.findMany({
    where: {
      createdAt: { gte: since }, status: { notIn: CLOSED_STATUSES as any }, id: opts.excludeId ? { not: opts.excludeId } : undefined,
      ...(opts.ownOnly ? { requesterId: opts.requesterId } : {}),
    },
    select: { id: true, ticketNumber: true, subject: true, description: true, status: true },
    orderBy: { createdAt: "desc" }, take: 300,
  });
  const text = `${subject} ${description}`;
  return candidates
    .map((c) => ({ id: c.id, ticketNumber: c.ticketNumber, subject: c.subject, status: c.status, similarity: +textSimilarity(text, `${c.subject} ${c.description}`).toFixed(2) }))
    .filter((c) => c.similarity >= duplicateThreshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
}

export interface Cluster { categoryName: string; count: number; ticketIds: string[]; ticketNumbers: string[]; sampleSubject: string; firstAt: Date; lastAt: Date }

/** Possible major incidents: connected groups of similar open tickets raised inside a short window. */
export async function detectClusters(): Promise<Cluster[]> {
  const s = await getSetting("ai");
  const since = new Date(Date.now() - s.clusterWindowMins * 60_000);
  const tickets = await prisma.ticket.findMany({
    where: { createdAt: { gte: since }, status: { notIn: CLOSED_STATUSES as any } },
    select: { id: true, ticketNumber: true, subject: true, description: true, createdAt: true, category: { select: { name: true } } },
    orderBy: { createdAt: "asc" }, take: 500,
  });
  const parent = tickets.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < tickets.length; i++)
    for (let j = i + 1; j < tickets.length; j++)
      if (textSimilarity(tickets[i].subject + " " + tickets[i].description, tickets[j].subject + " " + tickets[j].description) >= 0.35) parent[find(j)] = find(i);
  const groups = new Map<number, number[]>();
  tickets.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  return Array.from(groups.values())
    .filter((g) => g.length >= s.clusterMinTickets)
    .map((g) => ({
      categoryName: tickets[g[0]].category?.name ?? "Uncategorised", count: g.length,
      ticketIds: g.map((i) => tickets[i].id), ticketNumbers: g.map((i) => tickets[i].ticketNumber),
      sampleSubject: tickets[g[0]].subject, firstAt: tickets[g[0]].createdAt, lastAt: tickets[g[g.length - 1]].createdAt,
    }))
    .sort((a, b) => b.count - a.count);
}
