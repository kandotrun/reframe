import { createCaseState, getApprovalGate, getImpactedDecisionIds, getImpacts } from "./engine";
import { scenarioById, scenarios } from "./seed";
import type { CaseState, DecisionSnapshot, TimelineEvent, WorkspaceState } from "./types";

export const STORAGE_KEY = "reframe.workspace.v1";
const LIMIT = 1_000_000;
const REVIEW_IDS = ["production", "procurement", "quality"] as const;
const EVENT_TYPES = ["initial", "revision", "review", "candidate", "option", "approval"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`読み込めませんでした：${message}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 4000): value is string {
  return typeof value === "string" && value.length <= max;
}

function date(value: unknown): value is string {
  return text(value, 40) && Number.isFinite(Date.parse(value));
}

function snapshot(value: unknown): value is DecisionSnapshot {
  return record(value)
    && text(value.id, 150) && text(value.decisionId, 100) && text(value.outcome)
    && Array.isArray(value.sourceRefs) && value.sourceRefs.length <= 20 && value.sourceRefs.every((ref) => text(ref, 150))
    && date(value.at) && text(value.author, 100)
    && (value.supersedes === undefined || text(value.supersedes, 150))
    && (value.optionId === undefined || text(value.optionId, 100));
}

function timelineEvent(value: unknown): value is TimelineEvent {
  return record(value)
    && text(value.id, 150) && typeof value.type === "string" && EVENT_TYPES.includes(value.type)
    && date(value.at) && text(value.title, 200) && text(value.detail) && text(value.actor, 100);
}

function sameOriginal(a: DecisionSnapshot, b: DecisionSnapshot): boolean {
  return a.id === b.id && a.decisionId === b.decisionId && a.outcome === b.outcome
    && a.at === b.at && a.author === b.author
    && a.supersedes === b.supersedes && a.optionId === b.optionId
    && JSON.stringify(a.sourceRefs) === JSON.stringify(b.sourceRefs);
}

/**
 * Accepts only the current fictional fixture IDs. No files, URLs, HTML, or code are
 * executed by an import. This is a portable local demo state, not signed evidence.
 */
export function importWorkspace(json: string): WorkspaceState {
  assert(typeof json === "string" && json.length <= LIMIT, "ファイルは1MB以下のJSONにしてください。");
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error("読み込めませんでした：JSONの形式が正しくありません。"); }
  assert(record(parsed), "ワークスペースの形式が正しくありません。");
  if (parsed.format !== undefined) {
    assert(parsed.format === "reframe-workspace" && parsed.schemaVersion === 1, "対応していない書き出し形式です。");
    parsed = parsed.workspace;
  }
  assert(record(parsed) && parsed.version === 1, "対応していないデータバージョンです。");
  assert(typeof parsed.activeCaseId === "string" && Object.hasOwn(scenarioById, parsed.activeCaseId), "案件IDが見つかりません。");
  assert(record(parsed.cases), "案件データがありません。");
  const validated = {} as WorkspaceState["cases"];
  for (const scenario of scenarios) {
    const value = parsed.cases[scenario.id];
    assert(record(value), `${scenario.order.id}のデータがありません。`);
    assert(typeof value.revisionApplied === "boolean" && typeof value.approved === "boolean", "改訂・確定状態が正しくありません。");
    assert(record(value.reviews) && REVIEW_IDS.every((id) => ["pending", "acknowledged"].includes(String((value.reviews as Record<string, unknown>)[id]))), "確認状態が正しくありません。");
    assert(record(value.reviewNotes) && REVIEW_IDS.every((id) => text((value.reviewNotes as Record<string, unknown>)[id], 2000)), "確認メモが正しくありません。");
    assert(record(value.candidates), "関連候補の状態がありません。");
    for (const candidate of scenario.candidates) {
      assert(["suggested", "accepted", "rejected"].includes(String(value.candidates[candidate.id])), "関連候補の状態が正しくありません。");
    }
    assert(value.selectedOptionId === null || scenario.options.some((option) => option.id === value.selectedOptionId && option.feasible), "適用できない対応案が含まれています。");
    assert(Array.isArray(value.snapshots) && value.snapshots.length <= 20 && value.snapshots.every(snapshot), "判断履歴が正しくありません。");
    assert(new Set(value.snapshots.map((item) => item.id)).size === value.snapshots.length, "判断履歴のIDが重複しています。");
    assert(Array.isArray(value.history) && value.history.length > 0 && value.history.length <= 1000 && value.history.every(timelineEvent), "操作履歴が正しくありません。");
    assert(new Set(value.history.map((item) => item.id)).size === value.history.length, "操作履歴のIDが重複しています。");
    assert(value.history.every((item, index) => item.id === `${scenario.id}:event:${index + 1}`), "操作履歴の連番が正しくありません。");
    const initial = createCaseState(scenario);
    for (const original of initial.snapshots) {
      const imported = value.snapshots.find((item) => item.id === original.id);
      assert(imported && sameOriginal(imported, original), "元の判断履歴が変更されています。");
    }
    // Whitelist properties rather than copying an arbitrary object from JSON.
    const next: CaseState = {
      revisionApplied: value.revisionApplied,
      approved: value.approved,
      selectedOptionId: value.selectedOptionId as string | null,
      reviews: Object.fromEntries(REVIEW_IDS.map((id) => [id, (value.reviews as Record<string, unknown>)[id]])) as CaseState["reviews"],
      reviewNotes: Object.fromEntries(REVIEW_IDS.map((id) => [id, (value.reviewNotes as Record<string, unknown>)[id]])) as CaseState["reviewNotes"],
      candidates: Object.fromEntries(scenario.candidates.map((candidate) => [candidate.id, (value.candidates as Record<string, unknown>)[candidate.id]])) as CaseState["candidates"],
      snapshots: value.snapshots.map((item) => ({
        id: item.id, decisionId: item.decisionId, outcome: item.outcome, sourceRefs: [...item.sourceRefs],
        at: item.at, author: item.author,
        ...(item.supersedes !== undefined ? { supersedes: item.supersedes } : {}),
        ...(item.optionId !== undefined ? { optionId: item.optionId } : {}),
      })),
      history: value.history.map((item) => ({ id: item.id, type: item.type, at: item.at, title: item.title, detail: item.detail, actor: item.actor })),
    };
    if (!next.revisionApplied) {
      assert(!next.approved && next.selectedOptionId === null, "改訂前の状態と対応案が一致しません。");
      assert(REVIEW_IDS.every((id) => next.reviews[id] === "pending"), "改訂前の確認状態が正しくありません。");
      assert(scenario.candidates.every((candidate) => next.candidates[candidate.id] === "suggested"), "改訂前の関連候補が変更されています。");
    }
    const impactedIds = getImpactedDecisionIds(scenario);
    const additions = next.snapshots.filter((item) => !initial.snapshots.some((original) => original.id === item.id));
    if (next.approved) {
      assert(getApprovalGate(scenario, { ...next, approved: false }).canApprove, "担当確認または対応案が不足しています。");
      assert(additions.length === impactedIds.length, "確定後の判断履歴が不足しています。");
      assert(new Set(additions.map((item) => item.decisionId)).size === additions.length, "更新された判断が重複しています。");
      for (const added of additions) {
        assert(impactedIds.includes(added.decisionId), "影響対象外の判断が更新されています。");
        const previous = initial.snapshots.find((item) => item.decisionId === added.decisionId)!;
        assert(added.supersedes === previous.id && added.optionId === next.selectedOptionId, "判断の更新元または対応案が一致しません。");
        assert(added.id === `${scenario.id}:${added.decisionId}:2`, "更新された判断のIDが正しくありません。");
        const expectedRefs = previous.sourceRefs.map((ref) =>
          getImpacts(scenario).find((impact) => impact.applies && impact.clause.beforeRef === ref)?.clause.afterRef ?? ref,
        );
        assert(JSON.stringify(added.sourceRefs) === JSON.stringify(expectedRefs), "更新された判断の根拠が一致しません。");
      }
    } else {
      assert(additions.length === 0 && next.snapshots.length === initial.snapshots.length, "未確定の新しい判断が含まれています。");
    }
    validated[scenario.id] = next;
  }
  return { version: 1, activeCaseId: parsed.activeCaseId as WorkspaceState["activeCaseId"], cases: validated };
}

export function exportWorkspace(state: WorkspaceState): string {
  return JSON.stringify({
    format: "reframe-workspace",
    schemaVersion: 1,
    notice: "Self-authored fictional demo. Local state is editable and is not a signed approval record.",
    workspace: state,
  }, null, 2);
}

export function tryImportWorkspace(json: string): { ok: true; state: WorkspaceState } | { ok: false; error: string } {
  try { return { ok: true, state: importWorkspace(json) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "読み込めませんでした。" }; }
}
