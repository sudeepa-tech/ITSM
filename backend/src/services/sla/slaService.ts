import { Priority, SLAStatus } from "@prisma/client";
import { addBusinessMinutes, businessMinutesBetween, Calendar } from "./businessTime";

export const DEFAULT_SLA_MINUTES: Record<Priority, { response: number; resolution: number }> = {
  P1: { response: 15, resolution: 240 },
  P2: { response: 30, resolution: 480 },
  P3: { response: 120, resolution: 1440 },
  P4: { response: 480, resolution: 4320 },
};

export const PAUSED_STATUSES = ["PENDING_USER", "PENDING_VENDOR", "PENDING_APPROVAL"];
export const CLOSED_STATUSES = ["RESOLVED", "CLOSED", "CANCELLED"];

interface PolicyLike { responseMins: number; resolutionMins: number; businessHoursOnly?: boolean }

export function computeDueDates(priority: Priority, policy: PolicyLike | null | undefined, calendar: Calendar, from = new Date()) {
  const d = DEFAULT_SLA_MINUTES[priority];
  const responseMins = policy?.responseMins ?? d.response;
  const resolutionMins = policy?.resolutionMins ?? d.resolution;
  const bh = !!policy?.businessHoursOnly;
  const add = (m: number) => (bh ? addBusinessMinutes(from, m, calendar) : new Date(from.getTime() + m * 60_000));
  return { responseDue: add(responseMins), resolutionDue: add(resolutionMins), businessHoursOnly: bh };
}

/** Time remaining ≥50% Healthy, <50% Warning, <20% At Risk, overdue Breached. */
export function computeSLAStatus(startedAt: Date, due: Date, now = new Date()): SLAStatus {
  if (now >= due) return SLAStatus.BREACHED;
  const total = due.getTime() - startedAt.getTime();
  const pct = total > 0 ? (due.getTime() - now.getTime()) / total : 0;
  if (pct < 0.2) return SLAStatus.AT_RISK;
  if (pct < 0.5) return SLAStatus.WARNING;
  return SLAStatus.HEALTHY;
}

/** When a paused clock resumes, push due dates out by the time spent paused
 * (business minutes for business-hours policies, wall-clock otherwise). */
export function extendForPause(due: Date, pausedAt: Date, now: Date, businessHoursOnly: boolean, calendar: Calendar): Date {
  if (businessHoursOnly) return addBusinessMinutes(due, businessMinutesBetween(pausedAt, now, calendar), calendar);
  return new Date(due.getTime() + (now.getTime() - pausedAt.getTime()));
}
