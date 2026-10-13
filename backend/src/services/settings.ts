import { prisma } from "../config/db";
import { Calendar, DEFAULT_CALENDAR } from "./sla/businessTime";
import { AssignmentWeights, DEFAULT_WEIGHTS } from "./assignmentEngine";

export interface AiSettings {
  /** Below this confidence a ticket is routed to human triage instead of auto-assigned. */
  minConfidenceForAutoAssign: number;
  /** Minimum share of query terms a KB article must match to be offered as a self-service answer. */
  deflectionMinCoverage: number;
  /** Text similarity above which an open ticket is flagged as a likely duplicate. */
  duplicateThreshold: number;
  /** N similar open tickets inside the window raise a major-incident alert. */
  clusterMinTickets: number;
  clusterWindowMins: number;
}

export const DEFAULT_AI: AiSettings = {
  minConfidenceForAutoAssign: 55,
  deflectionMinCoverage: 0.3,
  duplicateThreshold: 0.6,
  clusterMinTickets: 4,
  clusterWindowMins: 60,
};

const DEFAULTS = { assignmentWeights: DEFAULT_WEIGHTS, ai: DEFAULT_AI, calendar: DEFAULT_CALENDAR };
type Keys = keyof typeof DEFAULTS;
type Value<K extends Keys> = (typeof DEFAULTS)[K];

const cache = new Map<string, { at: number; v: unknown }>();
const TTL = 30_000;

export async function getSetting<K extends Keys>(key: K): Promise<Value<K>> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v as Value<K>;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const v = { ...DEFAULTS[key], ...((row?.value as object) ?? {}) } as Value<K>;
  cache.set(key, { at: Date.now(), v });
  return v;
}

export async function setSetting<K extends Keys>(key: K, value: Value<K>) {
  await prisma.appSetting.upsert({ where: { key }, update: { value: value as any }, create: { key, value: value as any } });
  cache.delete(key);
}

export const getCalendar = (): Promise<Calendar> => getSetting("calendar");
export const getWeights = (): Promise<AssignmentWeights> => getSetting("assignmentWeights");
