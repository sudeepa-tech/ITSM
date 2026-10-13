import { describe, expect, it } from "vitest";
import { Calendar, addBusinessMinutes, businessMinutesBetween, onShift, zonedParts } from "../src/services/sla/businessTime";
import { computeDueDates, computeSLAStatus, extendForPause } from "../src/services/sla/slaService";

const cal: Calendar = { enabled: true, timezone: "UTC", workDays: [1, 2, 3, 4, 5], startMin: 540, endMin: 1080, holidays: [] };

describe("addBusinessMinutes", () => {
  it("stays within the same day when time allows", () => {
    // Mon 2026-09-28 10:00 UTC + 2h
    expect(addBusinessMinutes(new Date("2026-09-28T10:00:00Z"), 120, cal).toISOString()).toBe("2026-09-28T12:00:00.000Z");
  });
  it("rolls over the evening to the next morning", () => {
    // Mon 17:00 + 2h => 1h Mon, 1h Tue from 09:00 => Tue 10:00
    expect(addBusinessMinutes(new Date("2026-09-28T17:00:00Z"), 120, cal).toISOString()).toBe("2026-09-29T10:00:00.000Z");
  });
  it("skips the weekend", () => {
    // Fri 17:30 + 60 min => 30 Fri, 30 Mon 09:30
    expect(addBusinessMinutes(new Date("2026-10-02T17:30:00Z"), 60, cal).toISOString()).toBe("2026-10-05T09:30:00.000Z");
  });
  it("skips holidays", () => {
    const c = { ...cal, holidays: ["2026-09-29"] };
    expect(addBusinessMinutes(new Date("2026-09-28T17:00:00Z"), 120, c).toISOString()).toBe("2026-09-30T10:00:00.000Z");
  });
  it("respects time zones (Asia/Kolkata is UTC+5:30)", () => {
    const ist = { ...cal, timezone: "Asia/Kolkata" };
    // 03:30 UTC = 09:00 IST on Monday; +60 min => 10:00 IST = 04:30 UTC
    expect(addBusinessMinutes(new Date("2026-09-28T03:30:00Z"), 60, ist).toISOString()).toBe("2026-09-28T04:30:00.000Z");
  });
  it("handles DST changes (New York, spring forward 2026-03-08)", () => {
    const ny = { ...cal, timezone: "America/New_York" };
    // Fri 2026-03-06 16:00 EST + 3h => 2h Fri, 1h Mon from 09:00 EDT => 10:00 EDT = 14:00Z
    expect(addBusinessMinutes(new Date("2026-03-06T21:00:00Z"), 180, ny).toISOString()).toBe("2026-03-09T14:00:00.000Z");
  });
  it("is plain wall-clock time when the calendar is disabled", () => {
    expect(addBusinessMinutes(new Date("2026-10-03T00:00:00Z"), 90, { ...cal, enabled: false }).toISOString()).toBe("2026-10-03T01:30:00.000Z");
  });
});

describe("businessMinutesBetween", () => {
  it("counts only working minutes", () => {
    // Fri 16:00 -> Mon 10:00 = 120 (Fri) + 60 (Mon)
    expect(businessMinutesBetween(new Date("2026-10-02T16:00:00Z"), new Date("2026-10-05T10:00:00Z"), cal)).toBe(180);
  });
  it("is the inverse of addBusinessMinutes", () => {
    const start = new Date("2026-09-30T15:10:00Z");
    const end = addBusinessMinutes(start, 900, cal);
    expect(businessMinutesBetween(start, end, cal)).toBe(900);
  });
});

describe("onShift", () => {
  it("checks local working hours", () => {
    expect(onShift(new Date("2026-09-28T10:00:00Z"), "UTC", [1, 2, 3, 4, 5], 540, 1080)).toBe(true);
    expect(onShift(new Date("2026-09-28T22:00:00Z"), "UTC", [1, 2, 3, 4, 5], 540, 1080)).toBe(false);
    expect(onShift(new Date("2026-09-27T10:00:00Z"), "UTC", [1, 2, 3, 4, 5], 540, 1080)).toBe(false); // Sunday
  });
  it("zonedParts reports the local weekday", () => {
    expect(zonedParts(new Date("2026-09-28T23:00:00Z"), "Asia/Tokyo").wd).toBe(2); // Tuesday in Tokyo
  });
});

describe("SLA status and pause", () => {
  const start = new Date("2026-09-28T00:00:00Z");
  const due = new Date("2026-09-28T10:00:00Z");
  it("moves Healthy -> Warning -> At Risk -> Breached as time runs out", () => {
    expect(computeSLAStatus(start, due, new Date("2026-09-28T04:00:00Z"))).toBe("HEALTHY");
    expect(computeSLAStatus(start, due, new Date("2026-09-28T06:00:00Z"))).toBe("WARNING");
    expect(computeSLAStatus(start, due, new Date("2026-09-28T09:00:00Z"))).toBe("AT_RISK");
    expect(computeSLAStatus(start, due, new Date("2026-09-28T10:00:01Z"))).toBe("BREACHED");
  });
  it("uses business hours only when the policy says so", () => {
    const p = { responseMins: 60, resolutionMins: 600, businessHoursOnly: true };
    const d = computeDueDates("P3", p, cal, new Date("2026-09-28T16:00:00Z"));
    expect(d.resolutionDue.toISOString()).toBe("2026-09-29T17:00:00.000Z");
    const wall = computeDueDates("P1", { ...p, businessHoursOnly: false }, cal, new Date("2026-09-28T16:00:00Z"));
    expect(wall.resolutionDue.toISOString()).toBe("2026-09-28T02:00:00.000Z".replace("2026-09-28T02", "2026-09-29T02"));
  });
  it("extends due dates by the time spent paused", () => {
    const d = extendForPause(due, new Date("2026-09-28T02:00:00Z"), new Date("2026-09-28T05:00:00Z"), false, cal);
    expect(d.toISOString()).toBe("2026-09-28T13:00:00.000Z");
  });
});
