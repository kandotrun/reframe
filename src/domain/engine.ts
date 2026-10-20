import { DEFAULT_CASE_ID, scenarioById, scenarios } from "./seed";
import type {
  ApplicabilityRule, ApprovalGate, CaseId, CaseState, CaseStatus,
  DecisionSnapshot, DomainAction, Impact, ReviewId, Scenario, TimelineEvent, WorkspaceState,
} from "./types";

const REVIEW_IDS: ReviewId[] = ["production", "procurement", "quality"];
const INITIAL_TIME = "2026-10-19T07:30:00.000Z";

const blankReviews = (): CaseState["reviews"] => ({
  production: "pending", procurement: "pending", quality: "pending",
});

const blankNotes = (): CaseState["reviewNotes"] => ({
  production: "", procurement: "", quality: "",
});

export function createCaseState(scenario: Scenario): CaseState {
  return {
    revisionApplied: false,
    reviews: blankReviews(),
    reviewNotes: blankNotes(),
    candidates: Object.fromEntries(scenario.candidates.map((candidate) => [candidate.id, "suggested" as const])),
    selectedOptionId: null,
    approved: false,
    snapshots: scenario.decisions.map((decision) => ({
      id: `${scenario.id}:${decision.id}:1`,
      decisionId: decision.id,
      outcome: decision.outcome,
      sourceRefs: [...decision.sourceRefs],
      at: INITIAL_TIME,
      author: decision.owner,
    })),
    history: [{
      id: `${scenario.id}:event:1`,
      type: "initial",
      at: INITIAL_TIME,
      title: `${scenario.revision.beforeVersion} を根拠に判断を確定`,
      detail: `${scenario.order.id} の条件を確認し、担当者へ引き継ぎました。`,
      actor: "サンプル履歴",
    }],
  };
}

export function createInitialState(): WorkspaceState {
  return {
    version: 1,
    activeCaseId: DEFAULT_CASE_ID,
    cases: Object.fromEntries(scenarios.map((scenario) => [scenario.id, createCaseState(scenario)])) as WorkspaceState["cases"],
  };
}

export function clauseApplies(
  rule: ApplicabilityRule,
  target: { productCode: string; productionDate: string },
): boolean {
  return rule.productCodes.includes(target.productCode) && target.productionDate >= rule.effectiveFrom;
}

/** Only explicit, versioned source references create confirmed impact edges. */
export function getImpacts(scenario: Scenario): Impact[] {
  return scenario.clauses.map((clause) => {
    const applies = clauseApplies(clause.applicability, {
      productCode: scenario.productCode,
      productionDate: scenario.order.productionDate,
    });
    return {
      clause,
      applies,
      reason: applies
        ? `${scenario.order.id} は ${clause.applicability.explanation} に該当します。`
        : clause.reason,
      decisions: applies
        ? scenario.decisions.filter((decision) => decision.sourceRefs.includes(clause.beforeRef))
        : [],
    };
  });
}

export function getImpactedDecisionIds(scenario: Scenario): string[] {
  return [...new Set(getImpacts(scenario).flatMap((impact) => impact.decisions.map((decision) => decision.id)))];
}

export function getRequiredReviews(scenario: Scenario) {
  return scenario.reviews;
}

export function getReviewTasks(scenario: Scenario, state: CaseState) {
  const option = scenario.options.find((item) => item.id === state.selectedOptionId);
  if (!option || option.recommended) return scenario.reviews;
  const focus = {
    production: "工程順序・作業枠・納品日",
    procurement: "手配先・追加費用・調整先",
    quality: "仕様適合・記録・出荷判定の前提",
  };
  return scenario.reviews.map((review) => ({
    ...review,
    task: `対応案「${option.title}」の${focus[review.id]}を確認する。前提条件：${option.conditions.join(" / ")}。`,
    confirmation: `対応案「${option.title}」について、${focus[review.id]}と前提条件を確認済み。`,
  }));
}

export function getApprovalGate(scenario: Scenario, state: CaseState): ApprovalGate {
  if (state.approved) return { canApprove: false, reasons: ["この対応方針はすでに確定しています。"] };
  const reasons: string[] = [];
  if (!state.revisionApplied) reasons.push("改訂版を取り込んでください。");
  const option = scenario.options.find((candidate) => candidate.id === state.selectedOptionId);
  if (!option) reasons.push("対応案を選んでください。");
  else if (!option.feasible) reasons.push(option.infeasibleReason ?? "この対応案は適用条件を満たしません。");
  scenario.reviews.forEach((review) => {
    if (state.reviews[review.id] !== "acknowledged") reasons.push(`${review.label}の確認が必要です。`);
  });
  return { canApprove: reasons.length === 0, reasons };
}

export function getCaseStatus(scenario: Scenario, state: CaseState): CaseStatus {
  if (!state.revisionApplied) return "approved";
  if (state.approved) return "resolved";
  if (getApprovalGate(scenario, state).canApprove) return "ready";
  return "needs-review";
}

export function getDecisionStatus(scenario: Scenario, state: CaseState, decisionId: string): "approved" | "needs-review" | "updated" {
  if (!state.revisionApplied || !getImpactedDecisionIds(scenario).includes(decisionId)) return "approved";
  return state.approved ? "updated" : "needs-review";
}

export function getCurrentSnapshot(state: CaseState, decisionId: string): DecisionSnapshot | undefined {
  return [...state.snapshots].reverse().find((snapshot) => snapshot.decisionId === decisionId);
}

function timestamp(action: { at?: string }, scenario: Scenario): string {
  // Caller supplies wall-clock time. The fallback keeps the reducer deterministic.
  return action.at && Number.isFinite(Date.parse(action.at)) ? action.at : scenario.revision.receivedAt;
}

function event(state: CaseState, scenario: Scenario, value: Omit<TimelineEvent, "id">): TimelineEvent {
  return { ...value, id: `${scenario.id}:event:${state.history.length + 1}` };
}

function replaceCase(state: WorkspaceState, caseId: CaseId, next: CaseState): WorkspaceState {
  return { ...state, cases: { ...state.cases, [caseId]: next } };
}

export function domainReducer(state: WorkspaceState, action: DomainAction): WorkspaceState {
  if (action.type === "restore") return action.state;
  if (action.type === "reset") {
    if (!action.caseId) return createInitialState();
    const scenario = scenarioById[action.caseId];
    return scenario ? replaceCase(state, action.caseId, createCaseState(scenario)) : state;
  }
  if (!scenarioById[action.caseId]) return state;
  if (action.type === "select-case") return { ...state, activeCaseId: action.caseId };
  const scenario = scenarioById[action.caseId];
  const current = state.cases[action.caseId];
  const at = timestamp(action, scenario);

  if (action.type === "apply-revision") {
    if (current.revisionApplied) return state;
    const affected = getImpactedDecisionIds(scenario).length;
    return replaceCase(state, action.caseId, {
      ...current,
      revisionApplied: true,
      history: [...current.history, event(current, scenario, {
        type: "revision", at, actor: "あなた",
        title: `${scenario.revision.afterVersion} を取り込み`,
        detail: `適用条件と旧版への明示的な参照から、${affected}件の判断を再確認対象にしました。AIの関連候補は未確認です。`,
      })],
    });
  }

  // Confirmed snapshots are frozen. A reset starts a fresh local simulation.
  if (!current.revisionApplied || current.approved) return state;

  if (action.type === "acknowledge-review") {
    const review = getReviewTasks(scenario, current).find((item) => item.id === action.reviewId);
    if (!review || current.reviews[action.reviewId] === "acknowledged") return state;
    const note = (action.note ?? review.confirmation).trim().slice(0, 2000);
    return replaceCase(state, action.caseId, {
      ...current,
      reviews: { ...current.reviews, [action.reviewId]: "acknowledged" },
      reviewNotes: { ...current.reviewNotes, [action.reviewId]: note },
      history: [...current.history, event(current, scenario, {
        type: "review", at, actor: review.label,
        title: `${review.label}の確認を記録`,
        detail: note || review.confirmation,
      })],
    });
  }

  if (action.type === "accept-candidate" || action.type === "reject-candidate") {
    const candidate = scenario.candidates.find((item) => item.id === action.candidateId);
    if (!candidate) return state;
    const disposition = action.type === "accept-candidate" ? "accepted" : "rejected";
    if (current.candidates[candidate.id] === disposition) return state;
    return replaceCase(state, action.caseId, {
      ...current,
      candidates: { ...current.candidates, [candidate.id]: disposition },
      history: [...current.history, event(current, scenario, {
        type: "candidate", at, actor: "あなた",
        title: disposition === "accepted" ? "関連資料を確認対象に追加" : "関連候補を対象から除外",
        detail: `${candidate.title}。${disposition === "accepted" ? "関連資料の追加だけでは、適用や承認は確定しません。" : candidate.note}`,
      })],
    });
  }

  if (action.type === "select-option") {
    const option = scenario.options.find((item) => item.id === action.optionId);
    if (!option || !option.feasible || current.selectedOptionId === option.id) return state;
    const hasChecks = REVIEW_IDS.some((id) => current.reviews[id] === "acknowledged");
    return replaceCase(state, action.caseId, {
      ...current,
      selectedOptionId: option.id,
      // A new plan requires fresh confirmations; earlier notes remain in audit events.
      reviews: hasChecks ? blankReviews() : current.reviews,
      reviewNotes: hasChecks ? blankNotes() : current.reviewNotes,
      history: [...current.history, event(current, scenario, {
        type: "option", at, actor: "あなた",
        title: `対応案を選択：${option.title}`,
        detail: `${option.tradeoff}${hasChecks ? " 対応案を選んだため、この案に対して担当者の確認をやり直します。" : ""}`,
      })],
    });
  }

  if (action.type === "approve") {
    if (!getApprovalGate(scenario, current).canApprove) return state;
    const option = scenario.options.find((item) => item.id === current.selectedOptionId)!;
    const impacts = getImpacts(scenario);
    const updated: DecisionSnapshot[] = getImpactedDecisionIds(scenario).map((decisionId) => {
      const previous = getCurrentSnapshot(current, decisionId)!;
      const refs = previous.sourceRefs.map((ref) => {
        const impact = impacts.find((item) => item.applies && item.clause.beforeRef === ref);
        return impact?.clause.afterRef ?? ref;
      });
      return {
        id: `${scenario.id}:${decisionId}:2`,
        decisionId,
        outcome: `${option.title}。${option.deliveryDate}納品を前提に対応方針を確定。条件：${option.conditions.join(" / ")}`,
        sourceRefs: refs,
        at,
        author: "あなた（デモ）",
        supersedes: previous.id,
        optionId: option.id,
      };
    });
    return replaceCase(state, action.caseId, {
      ...current,
      approved: true,
      snapshots: [...current.snapshots, ...updated],
      history: [...current.history, event(current, scenario, {
        type: "approval", at, actor: "あなた（デモ）",
        title: "対応方針を確定して引き継ぎ",
        detail: `${option.title}。3部門の確認を記録し、${updated.length}件の判断を更新しました。実際の検査・出荷・外部への通知は行いません。`,
      })],
    });
  }
  return state;
}
