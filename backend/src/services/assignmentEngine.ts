/**
 * Weighted skill-based routing. Weights are admin-configurable (AppSetting
 * "assignmentWeights"); every candidate's factor scores are returned so the UI can
 * explain *why* someone was picked.
 */
export interface AssignmentWeights {
  skillMatch: number;
  categoryExpertise: number;
  workload: number;
  availability: number;
  avgResolution: number;
  locationShift: number;
  slaRisk: number;
}

export const DEFAULT_WEIGHTS: AssignmentWeights = {
  skillMatch: 0.35, categoryExpertise: 0.2, workload: 0.15, availability: 0.1, avgResolution: 0.1, locationShift: 0.05, slaRisk: 0.05,
};

export interface CandidateEmployee {
  id: string;
  name: string;
  team: string;
  available: boolean;
  avgResolutionHrs: number;
  openTicketCount: number;
  capacity: number;
  skillLevels: Record<string, number>;
  resolvedInCategoryCount: number;
  onShift: boolean;
  atRiskTicketCount: number;
}

export interface AssignmentScore {
  employeeId: string;
  name: string;
  team: string;
  skillMatch: number;
  categoryExpertise: number;
  workloadScore: number;
  availabilityScore: number;
  resolutionScore: number;
  shiftScore: number;
  slaRiskScore: number;
  composite: number;
}

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

export function scoreCandidates(requiredSkills: string[], candidates: CandidateEmployee[], w: AssignmentWeights = DEFAULT_WEIGHTS): AssignmentScore[] {
  const maxHistorical = Math.max(1, ...candidates.map((c) => c.resolvedInCategoryCount));
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1; // tolerate weights that don't sum to 1

  return candidates
    .map((c) => {
      const levels = requiredSkills.map((s) => c.skillLevels[s] ?? 0);
      const skillMatch = levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : 20;
      const categoryExpertise = Math.round((c.resolvedInCategoryCount / maxHistorical) * 100);
      const workloadScore = clamp(Math.round(100 - (c.openTicketCount / Math.max(1, c.capacity)) * 100));
      const availabilityScore = c.available ? 100 : 0;
      const resolutionScore = clamp(Math.round(100 - c.avgResolutionHrs * 15));
      const shiftScore = c.onShift ? 100 : 25;
      const slaRiskScore = clamp(100 - c.atRiskTicketCount * 25);
      const composite = Math.round(
        (skillMatch * w.skillMatch + categoryExpertise * w.categoryExpertise + workloadScore * w.workload + availabilityScore * w.availability +
          resolutionScore * w.avgResolution + shiftScore * w.locationShift + slaRiskScore * w.slaRisk) / total
      );
      return { employeeId: c.id, name: c.name, team: c.team, skillMatch, categoryExpertise, workloadScore, availabilityScore, resolutionScore, shiftScore, slaRiskScore, composite };
    })
    .sort((a, b) => b.composite - a.composite);
}

export function pickAssignee(requiredSkills: string[], candidates: CandidateEmployee[], weights?: AssignmentWeights) {
  // Never auto-assign to someone who is marked unavailable.
  const eligible = candidates.filter((c) => c.available);
  const ranked = scoreCandidates(requiredSkills, eligible, weights);
  return { winner: ranked[0] ?? null, ranked };
}
