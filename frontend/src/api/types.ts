export type Role = "END_USER" | "AGENT" | "ADMIN";
export type Priority = "P1" | "P2" | "P3" | "P4";
export type SlaStatus = "HEALTHY" | "WARNING" | "AT_RISK" | "BREACHED";
export type TicketStatus = "NEW" | "AI_ANALYSIS" | "ASSIGNED" | "ACCEPTED" | "IN_PROGRESS" | "PENDING_USER" | "PENDING_VENDOR" | "PENDING_APPROVAL" | "RESOLVED" | "CLOSED" | "REOPENED" | "ESCALATED" | "CANCELLED";
export type Provider = "anthropic" | "rules";

export interface User { id: string; name: string; email: string; role: Role; department?: string | null; locale: string; timezone: string }

export interface Sla { status: SlaStatus; responseDue: string; resolutionDue: string; pausedAt: string | null; startedAt?: string; responseMetAt?: string | null; businessHoursOnly?: boolean }

export interface TicketRow {
  id: string; ticketNumber: string; subject: string; priority: Priority; status: TicketStatus; type: "INCIDENT" | "SERVICE_REQUEST"; channel: string; language: string;
  createdAt: string; updatedAt: string; isMajor: boolean; sentiment?: number | null; needsTriage?: boolean;
  requester: { name: string }; category: { name: string } | null; assignee: { id: string; team: string; user: { name: string } } | null; slaInstance: Sla | null;
}
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }

export interface AssignmentScore { employeeId: string; name: string; team: string; skillMatch: number; categoryExpertise: number; workloadScore: number; availabilityScore: number; resolutionScore: number; shiftScore: number; slaRiskScore: number; composite: number }

export interface Ticket extends Omit<TicketRow, "requester" | "category" | "assignee" | "slaInstance"> {
  description: string; requesterId: string; impact?: string; urgency?: string; tags: string[]; aiSummary: string | null; aiSummaryAt: string | null; aiSummaryProvider: Provider | null; resolutionNotes: string | null;
  csatScore: number | null; csatComment: string | null; firstResponseAt: string | null; reopenCount: number;
  requester: { id: string; name: string; email: string; locale: string; department?: string | null };
  assignee: { id: string; team: string; user: { name: string; email?: string } } | null;
  category: { id: string; name: string; subcategory?: string | null } | null;
  slaInstance: Sla | null;
  duplicateOf: { id: string; ticketNumber: string; subject: string } | null;
  aiAnalysis: null | { category: string; subcategory?: string; priority: string; type?: string; confidence: number; provider: Provider; language?: string; sentiment?: number; rootCause?: string; requiredSkills: string[]; similarTickets: string[]; assignmentReason?: { winner?: AssignmentScore; runnerUp?: AssignmentScore | null; autoAssigned?: boolean; minConfidence?: number; note?: string } };
  comments: { id: string; body: string; internal: boolean; aiAssisted: boolean; createdAt: string; author: { name: string; role: Role } }[];
  history: { id: string; event: string; oldValue?: string | null; newValue?: string | null; actor?: string | null; createdAt: string }[];
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }[];
}

export interface Classification { category: string; subcategory: string; service: string; type: "INCIDENT" | "SERVICE_REQUEST"; priority: Priority; requiredSkills: string[]; rootCause: string; confidence: number; language: string; sentiment: number; provider: Provider }
export interface DeflectResult { articles: { id: string; title: string; excerpt: string; coverage: number }[]; answer: string | null; provider: Provider; eventId: string | null }
export interface Insights { steps: string[]; stepsProvider: Provider; docs: { id: string; title: string; excerpt: string; relevance: number }[]; similar: { id: string; ticketNumber: string; subject: string; status: string; similarity: number; resolutionNotes: string | null }[] }
export interface Article { id: string; title: string; body?: string; category: string | null; keywords: string[]; language: string; status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; views: number; helpful: number; notHelpful: number; updatedAt: string; excerpt?: string }
export interface Notification { id: string; type: string; message: string; link: string | null; read: boolean; createdAt: string }
export interface Cluster { categoryName: string; count: number; ticketIds: string[]; ticketNumbers: string[]; sampleSubject: string; firstAt: string; lastAt: string }
export interface DirectoryEntry { id: string; name: string; team: string; available: boolean; openTickets: number }
