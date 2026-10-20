import { describe, expect, it } from "vitest";
import {
  clauseApplies, createInitialState, domainReducer, exportWorkspace, getApprovalGate,
  getCaseStatus, getDecisionStatus, getImpactedDecisionIds, getImpacts, importWorkspace,
  scenarioById, scenarios,
} from "../src/domain";
import type { CaseId, DomainAction, WorkspaceState } from "../src/domain";

const at = "2026-10-20T12:00:00.000Z";
const inspection = scenarioById.inspection;
const reduce = (state: WorkspaceState, action: DomainAction) => domainReducer(state, action);

function reviewedState(caseId: CaseId = "inspection") {
  let state = createInitialState();
  state = reduce(state, { type: "apply-revision", caseId, at });
  state = reduce(state, { type: "select-option", caseId, optionId: scenarioById[caseId].options[0].id, at });
  for (const review of scenarioById[caseId].reviews) {
    state = reduce(state, { type: "acknowledge-review", caseId, reviewId: review.id, at });
  }
  return state;
}

describe("versioned reference impact", () => {
  it("applies a revision idempotently without modifying approved history", () => {
    const original = createInitialState();
    const before = structuredClone(original);
    const changed = reduce(original, { type: "apply-revision", caseId: "inspection", at });
    const repeated = reduce(changed, { type: "apply-revision", caseId: "inspection", at });
    expect(original).toEqual(before);
    expect(changed.cases.inspection.revisionApplied).toBe(true);
    expect(changed.cases.inspection.snapshots).toEqual(original.cases.inspection.snapshots);
    expect(changed.cases.material).toBe(original.cases.material);
    expect(repeated).toBe(changed);
    expect(changed.cases.inspection.history).toHaveLength(2);
  });

  it("only marks decisions with applicable explicit references", () => {
    expect(getImpactedDecisionIds(inspection)).toEqual(["delivery", "release"]);
    const impacts = getImpacts(inspection);
    expect(impacts.find((item) => item.clause.id === "pilot-mark")?.applies).toBe(false);
    expect(impacts.find((item) => item.clause.id === "pilot-mark")?.decisions).toEqual([]);
    const state = reduce(createInitialState(), { type: "apply-revision", caseId: "inspection", at });
    expect(getDecisionStatus(inspection, state.cases.inspection, "commercial")).toBe("approved");
    expect(getDecisionStatus(inspection, state.cases.inspection, "delivery")).toBe("needs-review");
  });

  it("does not apply changed requirements to orders before the effective date", () => {
    for (const scenario of scenarios) {
      for (const clause of scenario.clauses) {
        expect(clauseApplies(clause.applicability, scenario.unaffectedOrder)).toBe(false);
      }
      expect(getImpacts(scenario).filter((item) => item.applies)).toHaveLength(2);
    }
  });
});

describe("human confirmation and plan approval", () => {
  it("cannot confirm a plan before revision, option, and all required reviews", () => {
    let state = createInitialState();
    expect(reduce(state, { type: "approve", caseId: "inspection", at })).toBe(state);
    state = reduce(state, { type: "apply-revision", caseId: "inspection", at });
    state = reduce(state, { type: "select-option", caseId: "inspection", optionId: "reserve", at });
    expect(getApprovalGate(inspection, state.cases.inspection).reasons).toHaveLength(3);
    state = reduce(state, { type: "acknowledge-review", caseId: "inspection", reviewId: "production", at });
    state = reduce(state, { type: "acknowledge-review", caseId: "inspection", reviewId: "quality", at });
    expect(getApprovalGate(inspection, state.cases.inspection).canApprove).toBe(false);
    expect(reduce(state, { type: "approve", caseId: "inspection", at })).toBe(state);
    state = reduce(state, { type: "acknowledge-review", caseId: "inspection", reviewId: "procurement", at });
    expect(getCaseStatus(inspection, state.cases.inspection)).toBe("ready");
  });

  it("rejects infeasible and unknown options at the domain boundary", () => {
    const state = reduce(createInitialState(), { type: "apply-revision", caseId: "inspection", at });
    expect(reduce(state, { type: "select-option", caseId: "inspection", optionId: "keep-sampling", at })).toBe(state);
    expect(reduce(state, { type: "select-option", caseId: "inspection", optionId: "does-not-exist", at })).toBe(state);
  });

  it("does not treat accepting AI candidates as checking tasks or approving", () => {
    let state = reduce(createInitialState(), { type: "apply-revision", caseId: "inspection", at });
    const beforeSnapshots = state.cases.inspection.snapshots;
    state = reduce(state, { type: "accept-candidate", caseId: "inspection", candidateId: "inspection-capacity", at });
    expect(state.cases.inspection.candidates["inspection-capacity"]).toBe("accepted");
    expect(state.cases.inspection.reviews.production).toBe("pending");
    expect(state.cases.inspection.snapshots).toBe(beforeSnapshots);
    expect(getApprovalGate(inspection, state.cases.inspection).canApprove).toBe(false);
    state = reduce(state, { type: "reject-candidate", caseId: "inspection", candidateId: "inspection-capacity", at });
    expect(state.cases.inspection.candidates["inspection-capacity"]).toBe("rejected");
  });

  it("invalidates prior confirmations when the selected response plan changes", () => {
    const ready = reviewedState();
    const changed = reduce(ready, { type: "select-option", caseId: "inspection", optionId: "reschedule", at });
    expect(Object.values(changed.cases.inspection.reviews)).toEqual(["pending", "pending", "pending"]);
    expect(getApprovalGate(inspection, changed.cases.inspection).canApprove).toBe(false);
    expect(changed.cases.inspection.history.length).toBe(ready.cases.inspection.history.length + 1);
    expect(changed.cases.inspection.history.at(-1)?.detail).toContain("確認をやり直");
  });

  it("requires fresh checks if a response plan is first chosen after acknowledgements", () => {
    let state = reduce(createInitialState(), { type: "apply-revision", caseId: "inspection", at });
    state = reduce(state, { type: "acknowledge-review", caseId: "inspection", reviewId: "production", at });
    state = reduce(state, { type: "select-option", caseId: "inspection", optionId: "reschedule", at });
    expect(state.cases.inspection.reviews.production).toBe("pending");
  });

  it.each(scenarios)("preserves old decisions and appends only affected updates for $id", (scenario) => {
    const ready = reviewedState(scenario.id);
    const originals = structuredClone(ready.cases[scenario.id].snapshots);
    const approved = reduce(ready, { type: "approve", caseId: scenario.id, at });
    const next = approved.cases[scenario.id];
    expect(next.approved).toBe(true);
    expect(getCaseStatus(scenario, next)).toBe("resolved");
    expect(next.snapshots.slice(0, originals.length)).toEqual(originals);
    const updates = next.snapshots.slice(originals.length);
    expect(updates.map((item) => item.decisionId)).toEqual(getImpactedDecisionIds(scenario));
    updates.forEach((item) => {
      expect(item.supersedes).toBe(originals.find((prior) => prior.decisionId === item.decisionId)?.id);
      expect(item.sourceRefs.some((ref) => ref.includes(scenario.revision.afterVersion.replace("Rev.", "R")))).toBe(true);
    });
    expect(reduce(approved, { type: "approve", caseId: scenario.id, at })).toBe(approved);
    expect(reduce(approved, { type: "select-option", caseId: scenario.id, optionId: scenario.options[1].id, at })).toBe(approved);
  });
});

describe("local persistence and portable JSON", () => {
  it("round trips both the initial and confirmed workspaces", () => {
    const initial = createInitialState();
    expect(importWorkspace(exportWorkspace(initial))).toEqual(initial);
    expect(importWorkspace(JSON.stringify(initial))).toEqual(initial);
    const ready = reviewedState();
    const approved = reduce(ready, { type: "approve", caseId: "inspection", at });
    expect(importWorkspace(exportWorkspace(approved))).toEqual(approved);
  });

  it("rejects unknown versions, malformed input and tampered approval", () => {
    expect(() => importWorkspace("{oops")).toThrow("JSON");
    expect(() => importWorkspace(JSON.stringify({ ...createInitialState(), version: 2 }))).toThrow("バージョン");
    const tampered = createInitialState();
    tampered.cases.inspection.approved = true;
    expect(() => importWorkspace(exportWorkspace(tampered))).toThrow();
    const changedOriginal = createInitialState();
    changedOriginal.cases.inspection.snapshots[0].outcome = "変更された過去";
    expect(() => importWorkspace(exportWorkspace(changedOriginal))).toThrow("元の判断履歴");
  });

  it("resets one case without discarding work on another", () => {
    let state = reviewedState();
    state = reduce(state, { type: "apply-revision", caseId: "material", at });
    const material = state.cases.material;
    const reset = reduce(state, { type: "reset", caseId: "inspection" });
    expect(reset.cases.inspection).toEqual(createInitialState().cases.inspection);
    expect(reset.cases.material).toBe(material);
  });
});
