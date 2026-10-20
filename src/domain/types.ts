/** Self-authored fictional fixtures. This is decision support, not production control. */
export type CaseId = "inspection" | "material" | "packaging";
export type ReviewId = "production" | "procurement" | "quality";
export type ReviewStatus = "pending" | "acknowledged";
export type CandidateDisposition = "suggested" | "accepted" | "rejected";
export type CaseStatus = "approved" | "needs-review" | "ready" | "resolved";
export type RiskLevel = "high" | "medium" | "low";

export interface Order {
  id: string;
  part: string;
  quantity: number;
  dueDate: string;
  productionDate: string;
  customer: string;
}

export interface ApplicabilityRule {
  effectiveFrom: string;
  productCodes: string[];
  explanation: string;
}

export interface ClauseChange {
  id: string;
  title: string;
  before: string;
  after: string;
  beforeRef: string;
  afterRef: string;
  reason: string;
  applicability: ApplicabilityRule;
}

export interface SourceDocument {
  id: string;
  title: string;
  kind: "specification" | "record" | "procedure" | "message";
  version: string;
  text: string;
  tag: string;
}

export interface Decision {
  id: string;
  title: string;
  owner: string;
  outcome: string;
  sourceRefs: string[];
}

export interface ReviewTask {
  id: ReviewId;
  label: string;
  person: string;
  initials: string;
  task: string;
  confirmation: string;
  sourceRefs: string[];
}

export interface DecisionOption {
  id: string;
  title: string;
  description: string;
  deliveryDate: string;
  addedCost: number;
  addedHours: number;
  conditions: string[];
  tradeoff: string;
  feasible: boolean;
  infeasibleReason?: string;
  recommended?: boolean;
}

export interface RelatedCandidate {
  id: string;
  title: string;
  text: string;
  relation: string;
  kind: "record" | "case" | "procedure";
  sourceRef: string;
  note: string;
}

export interface Scenario {
  id: CaseId;
  title: string;
  subtitle: string;
  summary: string;
  risk: RiskLevel;
  accent: string;
  order: Order;
  productCode: string;
  revision: {
    documentTitle: string;
    beforeVersion: string;
    afterVersion: string;
    receivedAt: string;
    summary: string;
    query: string;
  };
  clauses: ClauseChange[];
  documents: SourceDocument[];
  decisions: Decision[];
  reviews: ReviewTask[];
  options: DecisionOption[];
  candidates: RelatedCandidate[];
  unaffectedOrder: {
    id: string;
    productCode: string;
    productionDate: string;
    reason: string;
  };
}

export interface DecisionSnapshot {
  id: string;
  decisionId: string;
  outcome: string;
  sourceRefs: string[];
  at: string;
  author: string;
  supersedes?: string;
  optionId?: string;
}

export interface TimelineEvent {
  id: string;
  type: "initial" | "revision" | "review" | "candidate" | "option" | "approval";
  at: string;
  title: string;
  detail: string;
  actor: string;
}

export interface CaseState {
  revisionApplied: boolean;
  reviews: Record<ReviewId, ReviewStatus>;
  reviewNotes: Record<ReviewId, string>;
  candidates: Record<string, CandidateDisposition>;
  selectedOptionId: string | null;
  approved: boolean;
  snapshots: DecisionSnapshot[];
  history: TimelineEvent[];
}

export interface WorkspaceState {
  version: 1;
  activeCaseId: CaseId;
  cases: Record<CaseId, CaseState>;
}

type TimedAction = { at?: string };
export type DomainAction =
  | { type: "select-case"; caseId: CaseId }
  | ({ type: "apply-revision"; caseId: CaseId } & TimedAction)
  | ({ type: "acknowledge-review"; caseId: CaseId; reviewId: ReviewId; note?: string } & TimedAction)
  | ({ type: "accept-candidate" | "reject-candidate"; caseId: CaseId; candidateId: string } & TimedAction)
  | ({ type: "select-option"; caseId: CaseId; optionId: string } & TimedAction)
  | ({ type: "approve"; caseId: CaseId } & TimedAction)
  | { type: "reset"; caseId?: CaseId }
  | { type: "restore"; state: WorkspaceState };

export interface ApprovalGate {
  canApprove: boolean;
  reasons: string[];
}

export interface Impact {
  clause: ClauseChange;
  applies: boolean;
  reason: string;
  decisions: Decision[];
}
