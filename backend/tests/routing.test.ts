import { describe, expect, it } from "vitest";
import { CandidateEmployee, pickAssignee, scoreCandidates } from "../src/services/assignmentEngine";
import { ruleBasedClassify } from "../src/services/ai/classifier";

const base: CandidateEmployee = { id: "x", name: "X", team: "T", available: true, avgResolutionHrs: 3, openTicketCount: 2, capacity: 10, skillLevels: {}, resolvedInCategoryCount: 0, onShift: true, atRiskTicketCount: 0 };
const c = (o: Partial<CandidateEmployee>): CandidateEmployee => ({ ...base, ...o });

describe("assignment engine", () => {
  it("prefers the better skill match", () => {
    const { winner } = pickAssignee(["VPN"], [c({ id: "a", skillLevels: { VPN: 90 } }), c({ id: "b", skillLevels: { VPN: 40 } })]);
    expect(winner?.employeeId).toBe("a");
  });
  it("never picks unavailable staff", () => {
    const { winner } = pickAssignee(["VPN"], [c({ id: "a", available: false, skillLevels: { VPN: 100 } }), c({ id: "b", skillLevels: { VPN: 20 } })]);
    expect(winner?.employeeId).toBe("b");
  });
  it("penalises overloaded agents relative to their own capacity", () => {
    const [a, b] = ["a", "b"].map((id, i) => c({ id, skillLevels: { VPN: 70 }, capacity: 10, openTicketCount: i ? 9 : 1 }));
    expect(scoreCandidates(["VPN"], [b, a])[0].employeeId).toBe("a");
  });
  it("prefers on-shift agents and those without at-risk tickets when skills tie", () => {
    const r = scoreCandidates(["VPN"], [c({ id: "off", onShift: false, skillLevels: { VPN: 70 } }), c({ id: "on", skillLevels: { VPN: 70 } }), c({ id: "risky", atRiskTicketCount: 3, skillLevels: { VPN: 70 } })]);
    expect(r[0].employeeId).toBe("on");
    expect(r[r.length - 1].employeeId).not.toBe("on");
  });
  it("returns null when nobody is available", () => {
    expect(pickAssignee(["VPN"], [c({ available: false })]).winner).toBeNull();
  });
  it("honours custom weights", () => {
    const w = { skillMatch: 0, categoryExpertise: 0, workload: 1, availability: 0, avgResolution: 0, locationShift: 0, slaRisk: 0 };
    const r = scoreCandidates(["VPN"], [c({ id: "skilled", skillLevels: { VPN: 100 }, openTicketCount: 9 }), c({ id: "free", skillLevels: { VPN: 10 }, openTicketCount: 0 })], w);
    expect(r[0].employeeId).toBe("free");
  });
});

describe("rule-based classifier", () => {
  it("routes VPN outages as urgent incidents", () => {
    const r = ruleBasedClassify("VPN is down for everyone\nProduction cannot connect, urgent");
    expect(r.category).toBe("Network");
    expect(r.priority).toBe("P1");
    expect(r.type).toBe("INCIDENT");
  });
  it("treats access asks as low-priority service requests", () => {
    const r = ruleBasedClassify("Need access to shared drive\nPlease grant me permission, manager approved");
    expect(r.type).toBe("SERVICE_REQUEST");
    expect(r.priority).toBe("P4");
  });
  it("understands non-English tickets and reports language", () => {
    const r = ruleBasedClassify("La impresora no funciona\nBuenos días, la impresora del segundo piso no imprime");
    expect(r.category).toBe("Hardware");
    expect(r.language).toBe("es");
  });
  it("reports low confidence when nothing matches", () => {
    expect(ruleBasedClassify("hello\nsomething odd happened").confidence).toBeLessThan(55);
  });
});

describe("keyword matching regressions", () => {
  it("does not match keywords inside longer words", () => {
    expect(ruleBasedClassify("Question\nSomething happened while I was downloading a file").priority).toBe("P3");
    expect(ruleBasedClassify("Question\nSomething happened").confidence).toBeLessThan(55);
  });
  it("still matches plurals and inflections at word start", () => {
    expect(ruleBasedClassify("Printers\nAll printers on floor 3 are offline").category).toBe("Hardware");
  });
});

describe("keyword matcher precision", () => {
  it("finds short keywords as whole words and plurals", () => {
    expect(ruleBasedClassify("Problem\nThe VPN keeps failing").category).toBe("Network");
    expect(ruleBasedClassify("Problem\nMy apps keep freezing").category).toBe("Software");
  });
  it("does not fire on substrings", () => {
    expect(ruleBasedClassify("Hi\nThe reddish report was considered").confidence).toBeLessThan(55);
    expect(ruleBasedClassify("Note\nWe finished downloading the file").priority).toBe("P3");
  });
  it("treats real outage words as urgent", () => {
    expect(ruleBasedClassify("Outage\nThe server is down and production cannot work").priority).toBe("P1");
  });
});
