import { useEffect, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  scenarios, createInitialState, domainReducer, getCaseStatus, getApprovalGate,
  getImpacts, getReviewTasks, exportWorkspace, importWorkspace,
} from "./domain";
import type {
  CaseState, ClauseChange, DomainAction, Scenario, WorkspaceState,
} from "./domain/types";
import { initializeModel, rankCandidates, getModelStatus, getLastInference } from "./ml/ranker";
import "./styles.css";

type IconName = "arrow" | "check" | "chevron" | "close" | "document" | "download" | "flow" |
  "history" | "info" | "lab" | "link" | "more" | "play" | "plus" | "reset" |
  "search" | "shield" | "spark" | "upload" | "users" | "warning";
type Tab = "impact" | "sources" | "decision" | "evaluation";
type Selection = { kind: "clause" | "decision" | "review" | "candidate" | "document"; id: string };
type Method = "trained" | "lexical" | "embedding";
type Dispatch = (action: DomainAction) => void;
type Metrics = { mrr: number; ndcgAt5: number; recallAt5: number; top1: number; medianMs: number; p95Ms: number };
type Evaluation = {
  model: { name: string; architecture: string; parameterCount: number; onnxBytes: number };
  data: { source: string; trainQueries: number; devQueries: number; testQueries: number; trainFamilies: unknown; devFamilies: unknown; testFamilies: unknown };
  metrics: Record<Method, Metrics>;
  training: { epochs: number; bestEpoch: number; seed: number; durationSeconds: number };
  parity: { maxAbsoluteError: number; tolerance: number };
  limitations: string[];
  evaluatedAt: string;
};

const STORAGE_KEY = "reframe.workspace.v1";
const tabItems: { id: Tab; label: string; icon: IconName }[] = [
  { id: "impact", label: "変更の影響", icon: "flow" },
  { id: "sources", label: "根拠と差分", icon: "document" },
  { id: "decision", label: "判断・引き継ぎ", icon: "users" },
  { id: "evaluation", label: "評価ラボ", icon: "lab" },
];
const methodNames: Record<Method, string> = {
  trained: "学習済みモデル",
  lexical: "キーワード検索",
  embedding: "未学習の埋め込み",
};

function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M4 12h15M13 6l6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    document: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4" /></>,
    flow: <><rect x="3" y="9" width="5" height="6" rx="1" /><rect x="16" y="3" width="5" height="6" rx="1" /><rect x="16" y="15" width="5" height="6" rx="1" /><path d="M8 12h4V6h4M12 12v6h4" /></>,
    history: <><path d="M3 11a9 9 0 1 1 2.4 7M3 4v7h7" /><path d="M12 7v5l3 2" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
    lab: <><path d="M9 3h6M10 3v6L4 19a1.4 1.4 0 0 0 1.2 2h13.6A1.4 1.4 0 0 0 20 19L14 9V3M7 15h10" /></>,
    link: <><path d="m10 13 4-4M9 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M15 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(0 0) scale(.9)" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    play: <path d="m8 4 12 8-12 8z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    reset: <><path d="M3 10a9 9 0 1 1 1 8M3 3v7h7" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
    spark: <><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3zM20 2v4M18 4h4" /></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M5 16v5h14v-5" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1" /></>,
    warning: <><path d="m12 3 10 18H2zM12 9v5M12 17h.01" /></>,
  };
  return <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function BrandMark({ large = false }: { large?: boolean }) {
  return <svg width={large ? 42 : 30} height={large ? 42 : 30} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M6 6h12v5H11v15H6z" fill="currentColor" />
    <path d="M14 6h12v20H14v-5h7V11h-7z" fill="currentColor" opacity=".62" />
  </svg>;
}

function initialWorkspace(): WorkspaceState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return importWorkspace(stored);
  } catch { /* A corrupted or old local save must never prevent opening the demo. */ }
  return createInitialState();
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}
function formatTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function downloadFile(name: string, text: string) {
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  link.href = objectUrl;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
function statusInfo(state: CaseState) {
  if (state.approved) return { label: "判断を更新済み", className: "resolved", icon: "check" as IconName };
  if (state.revisionApplied) return { label: "再確認が必要", className: "review", icon: "warning" as IconName };
  return { label: "承認済み", className: "approved", icon: "check" as IconName };
}
function Status({ state, compact = false }: { state: CaseState; compact?: boolean }) {
  const status = statusInfo(state);
  return <span className={`status-badge ${status.className} ${compact ? "compact" : ""}`}><Icon name={status.icon} size={13} />{status.label}</span>;
}
function SectionHeading({ children, description, action }: { children: ReactNode; description?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{children}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

export default function App() {
  const [workspace, storeDispatch] = useReducer(domainReducer, undefined, initialWorkspace);
  const dispatch: Dispatch = (action) => {
    if (["select-case", "reset", "restore"].includes(action.type)) storeDispatch(action);
    else storeDispatch({ ...action, at: new Date().toISOString() } as DomainAction);
  };
  const [tab, setTab] = useState<Tab>("impact");
  const [selection, setSelection] = useState<Selection>({ kind: "clause", id: scenarios[0].clauses[0].id });
  const [queueFilter, setQueueFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [showAbout, setShowAbout] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [guideVisible, setGuideVisible] = useState(true);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scenario = scenarios.find((item) => item.id === workspace.activeCaseId) ?? scenarios[0];
  const caseState = workspace.cases[scenario.id];
  const gate = getApprovalGate(scenario, caseState);
  const reviewCount = scenario.reviews.filter((item) => caseState.reviews[item.id] === "acknowledged").length;
  const queue = scenarios.filter((item) => {
    const queryMatches = `${item.title} ${item.order.id} ${item.order.part}`.toLowerCase().includes(search.toLowerCase());
    const filterMatches = queueFilter === "all" || (queueFilter === "review" && workspace.cases[item.id].revisionApplied && !workspace.cases[item.id].approved);
    return queryMatches && filterMatches;
  });

  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4400);
  }
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, exportWorkspace(workspace)); } catch { /* Local persistence is best effort. */ }
  }, [workspace]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") { setShowAbout(false); setShowReset(false); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function selectCase(next: Scenario) {
    dispatch({ type: "select-case", caseId: next.id });
    setSelection({ kind: "clause", id: next.clauses[0].id });
    setReplayIndex(null);
    if (tab === "evaluation") setTab("impact");
  }
  function applyRevision() {
    dispatch({ type: "apply-revision", caseId: scenario.id });
    setSelection({ kind: "clause", id: scenario.clauses[0].id });
    setTab("impact");
    setReplayIndex(null);
    notify("改訂を取り込みました。根拠につながる判断を確認してください。");
  }
  function approve() {
    if (!gate.canApprove) return;
    dispatch({ type: "approve", caseId: scenario.id });
    setReplayIndex(null);
    notify("判断を更新しました。以前の根拠と回答も履歴に残っています。");
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      const restored = importWorkspace(await file.text());
      dispatch({ type: "restore", state: restored });
      const next = scenarios.find((item) => item.id === restored.activeCaseId) ?? scenarios[0];
      setSelection({ kind: "clause", id: next.clauses[0].id });
      setReplayIndex(null);
      notify("保存したワークスペースを読み込みました。");
    } catch {
      notify("読み込めませんでした。Reframeから書き出したJSONファイルを選んでください。");
    }
    if (importRef.current) importRef.current.value = "";
  }

  return <div className="app-shell">
    <a className="skip-link" href="#workspace-main">作業エリアへ移動</a>
    <nav className="app-rail" aria-label="メインナビゲーション">
      <button className="rail-brand" aria-label="Reframeについて" onClick={() => setShowAbout(true)}><BrandMark /></button>
      <div className="rail-actions">
        <button className={`rail-button ${tab !== "evaluation" ? "active" : ""}`} title="案件ワークスペース" aria-label="案件ワークスペース" onClick={() => setTab("impact")}><Icon name="flow" size={22} /></button>
        <button className={`rail-button ${tab === "evaluation" ? "active" : ""}`} title="評価ラボ" aria-label="評価ラボ" onClick={() => setTab("evaluation")}><Icon name="lab" size={22} /></button>
      </div>
      <div className="rail-bottom">
        <button className="rail-button" aria-label="Reframeについて" title="Reframeについて" onClick={() => setShowAbout(true)}><Icon name="info" size={21} /></button>
        <span className="rail-avatar" title="デモワークスペース">R</span>
      </div>
    </nav>

    <aside className="case-sidebar" aria-label="案件一覧">
      <div className="sidebar-brand"><strong>Reframe<span className="brand-period">.</span></strong><span className="demo-label">体験版</span></div>
      <div className="sidebar-heading"><span>ワークスペース</span><Icon name="chevron" size={14} /></div>
      <label className="case-search"><Icon name="search" size={16} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="案件を検索" aria-label="案件を検索" /><kbd>⌘ K</kbd></label>
      <div className="queue-tabs" role="group" aria-label="案件を絞り込み">
        <button className={queueFilter === "all" ? "active" : ""} onClick={() => setQueueFilter("all")}>すべて <span>{scenarios.length}</span></button>
        <button className={queueFilter === "review" ? "active" : ""} onClick={() => setQueueFilter("review")}>要確認 <span>{scenarios.filter((item) => workspace.cases[item.id].revisionApplied && !workspace.cases[item.id].approved).length}</span></button>
      </div>
      <div className="case-list">
        {queue.map((item) => <button key={item.id} className={`case-item ${item.id === scenario.id ? "selected" : ""}`} onClick={() => selectCase(item)} aria-current={item.id === scenario.id ? "true" : undefined}>
          <span className="case-item-top"><span className="order-code">{item.order.id}</span><span className={`case-dot ${workspace.cases[item.id].approved ? "green" : workspace.cases[item.id].revisionApplied ? "amber" : ""}`} /></span>
          <strong>{item.title}</strong>
          <span className="case-item-subtitle">{item.order.part}</span>
          <span className="case-item-bottom"><span>納期 {formatDate(item.order.dueDate)}</span><span>{workspace.cases[item.id].approved ? "更新済み" : workspace.cases[item.id].revisionApplied ? "再確認" : "改訂待ち"}</span></span>
        </button>)}
        {queue.length === 0 && <div className="queue-empty"><Icon name="search" size={22} /><p>{queueFilter === "review" ? "再確認が必要な案件はありません。" : "一致する案件がありません。"}</p><button className="text-button" onClick={() => { setQueueFilter("all"); setSearch(""); }}>すべての案件を見る</button></div>}
      </div>
      <div className="sidebar-foot">
        <div className="workspace-marker"><span /><div><strong>あなたのブラウザに保存</strong><p>架空の案件で自由に試せます</p></div></div>
        <div className="sidebar-utilities">
          <button onClick={() => { downloadFile("reframe-workspace.json", exportWorkspace(workspace)); notify("判断履歴を含むワークスペースを書き出しました。"); }}><Icon name="download" size={14} />書き出す</button>
          <button onClick={() => importRef.current?.click()}><Icon name="upload" size={14} />読み込む</button>
          <input ref={importRef} className="visually-hidden" type="file" accept=".json,application/json" onChange={(event) => { void importFile(event.target.files?.[0]); }} aria-label="ワークスペースファイル" />
        </div>
      </div>
    </aside>

    <div className="workspace">
      <header className="workspace-topbar">
        <div className="breadcrumb"><span>案件</span><Icon name="chevron" size={13} /><strong>{scenario.order.id}</strong><span className="environment-label">架空データのデモ</span></div>
        <div className="topbar-actions"><button className="text-button reset-button" onClick={() => setShowReset(true)}><Icon name="reset" size={14} />最初から試す</button><button className="help-button" onClick={() => setGuideVisible((value) => !value)} aria-pressed={guideVisible}><Icon name="play" size={12} />使い方</button></div>
      </header>
      <main id="workspace-main" tabIndex={-1}>
        <div className="case-header">
          <div className="case-heading">
            <div className="case-kicker"><span className="case-type">変更管理</span><Status state={caseState} /></div>
            <h1>{scenario.title}</h1>
            <p>{scenario.subtitle}</p>
            <div className="case-facts"><span><Icon name="document" size={14} />{scenario.order.part}</span><span>{scenario.order.quantity.toLocaleString()} 個</span><span>納期 <strong>{formatDate(scenario.order.dueDate)}</strong></span></div>
          </div>
          <div className="case-primary">
            {!caseState.revisionApplied ? <button className="button primary" onClick={applyRevision}><Icon name="plus" size={17} />改訂を取り込む</button> : caseState.approved ? <div className="update-complete"><span><Icon name="check" size={18} /></span><div><strong>新しい判断につながりました</strong><p>根拠と引き継ぎを保存済み</p></div></div> : <button className="button primary" onClick={() => setTab("decision")}><Icon name="users" size={17} />判断・引き継ぎへ<span className="button-count">{reviewCount}/{scenario.reviews.length}</span></button>}
            {!caseState.revisionApplied && <span className="revision-ready">新しい {scenario.revision.afterVersion} が届いています</span>}
          </div>
        </div>

        {guideVisible && <div className="guide-strip">
          <span className="guide-intro"><Icon name="play" size={13} />変化をたどる</span>
          <span className={`guide-step ${caseState.revisionApplied ? "done" : "current"}`}><b>{caseState.revisionApplied ? <Icon name="check" size={11} /> : "1"}</b>改訂を取り込む</span>
          <Icon name="chevron" size={12} />
          <span className={`guide-step ${caseState.revisionApplied && !caseState.approved ? "current" : ""} ${caseState.approved ? "done" : ""}`}><b>{caseState.approved ? <Icon name="check" size={11} /> : "2"}</b>根拠と影響を確認</span>
          <Icon name="chevron" size={12} />
          <span className={`guide-step ${caseState.approved ? "done" : ""}`}><b>{caseState.approved ? <Icon name="check" size={11} /> : "3"}</b>判断して引き継ぐ</span>
          <button className="icon-button guide-close" aria-label="使い方を閉じる" onClick={() => setGuideVisible(false)}><Icon name="close" size={14} /></button>
        </div>}

        <div className="workspace-tabs" role="tablist" aria-label="案件の表示">
          {tabItems.map((item) => <button key={item.id} id={`tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><Icon name={item.icon} size={16} />{item.label}{item.id === "decision" && caseState.revisionApplied && !caseState.approved && <span className="tab-dot" />}</button>)}
        </div>

        <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className={`tab-content tab-${tab}`}>
          {tab === "impact" && <div className="impact-layout">
            <div className="map-column">
              <div className="map-titlebar"><div><h2>判断のつながり</h2><p>{caseState.approved ? "更新した判断と、その根拠をたどれます。" : caseState.revisionApplied ? "変わった根拠から、確認が必要な判断をたどります。" : "いまの判断が、何を根拠にしているかを見渡します。"}</p></div><span className="map-legends"><span><i />明示的な参照</span></span></div>
              <DependencyMap scenario={scenario} state={caseState} selection={selection} onSelect={(next) => { setSelection(next); }} replayIndex={replayIndex} />
              <div className="unaffected-note"><Icon name="shield" size={15} /><span><strong>{scenario.unaffectedOrder.id}</strong> は適用対象外</span><span>{scenario.unaffectedOrder.reason}</span></div>
              <HistoryReplay scenario={scenario} state={caseState} replayIndex={replayIndex} onReplay={setReplayIndex} />
              <div className="map-footnote"><Icon name="info" size={13} /><span>線は登録済みの参照関係です。AIの関連候補は、右側の「関連する情報」から確認できます。</span></div>
            </div>
            <EvidencePanel key={`${scenario.id}-${selection.kind}-${selection.id}`} scenario={scenario} state={caseState} selection={selection} dispatch={dispatch} onSelect={setSelection} onNavigate={setTab} notify={notify} />
          </div>}
          {tab === "sources" && <SourcesView scenario={scenario} state={caseState} onApply={applyRevision} onSelect={(next) => { setSelection(next); setTab("impact"); }} />}
          {tab === "decision" && <DecisionView scenario={scenario} state={caseState} dispatch={dispatch} onApprove={approve} onApply={applyRevision} notify={notify} onShowSource={(next) => { setSelection(next); setTab("impact"); }} />}
          {tab === "evaluation" && <EvaluationLab />}
        </section>
      </main>
      <footer className="workspace-footer"><span>Reframe <span className="footer-divider">/</span> 根拠から、次の判断へ。</span><a href="https://github.com/kandotrun/reframe" target="_blank" rel="noreferrer">ソースコード<Icon name="arrow" size={12} /></a></footer>
    </div>

    {toast && <div className="toast" role="status"><span className="toast-icon"><Icon name="check" size={16} /></span>{toast}<button className="icon-button" aria-label="通知を閉じる" onClick={() => setToast("")}><Icon name="close" size={15} /></button></div>}
    {showAbout && <Modal title="根拠から、次の判断へ。" onClose={() => setShowAbout(false)}>
      <div className="about-brand"><BrandMark large /><strong>Reframe<span>.</span></strong></div>
      <p>仕様が変わったら、過去の判断も見直す必要があります。Reframeは、改訂された文書、判断の根拠、担当者の確認をひとつにつなぐワークスペースです。</p>
      <div className="about-facts"><p><Icon name="document" size={17} /><span>案件・人物・文書は、このデモのために作成した架空データです。</span></p><p><Icon name="shield" size={17} /><span>操作履歴はこのブラウザに保存されます。書き出して、後から再開できます。</span></p><p><Icon name="users" size={17} /><span>AIは関連情報を提案します。適用条件と承認は、人が確かめます。</span></p></div>
      <button className="button primary wide" onClick={() => setShowAbout(false)}>ワークスペースを開く<Icon name="arrow" size={16} /></button>
    </Modal>}
    {showReset && <Modal title="この案件を最初から試しますか？" onClose={() => setShowReset(false)}>
      <p>「{scenario.title}」の確認・判断・操作履歴を、改訂前の状態に戻します。ほかの案件の操作は残ります。</p>
      <div className="modal-actions"><button className="button secondary" onClick={() => setShowReset(false)}>キャンセル</button><button className="button primary" onClick={() => { dispatch({ type: "reset", caseId: scenario.id }); setReplayIndex(null); setSelection({ kind: "clause", id: scenario.clauses[0].id }); setShowReset(false); setTab("impact"); notify("案件を改訂前の状態に戻しました。"); }}>最初から試す</button></div>
    </Modal>}
  </div>;
}

function DependencyMap({ scenario, state, selection, onSelect, replayIndex }: { scenario: Scenario; state: CaseState; selection: Selection; onSelect: (selection: Selection) => void; replayIndex: number | null }) {
  const events = replayIndex === null ? state.history : state.history.slice(0, replayIndex + 1);
  const revisionVisible = replayIndex === null ? state.revisionApplied : events.some((event) => event.type === "revision");
  const approvedVisible = replayIndex === null ? state.approved : events.some((event) => event.type === "approval");
  const positions = [20, 49, 78];
  const impacts = getImpacts(scenario);
  const affected = new Set(impacts.filter((impact) => impact.applies).flatMap((impact) => impact.decisions.map((decision) => decision.id)));
  const reviewTasks = getReviewTasks(scenario, state);
  const normalizedRefs = (refs: string[]) => scenario.clauses.filter((clause) => refs.some((reference) => [clause.beforeRef, clause.afterRef, clause.id].includes(reference))).map((clause) => clause.id);
  return <div className={`dependency-viewport ${revisionVisible ? "has-revision" : ""} ${approvedVisible ? "is-resolved" : ""}`} aria-label="根拠、判断、確認担当者のつながり">
    <div className="dependency-map">
      <div className="map-column-label source-label">根拠となる文書</div><div className="map-column-label decisions-label">これまでの判断</div><div className="map-column-label reviews-label">確認する人</div>
      <svg className="graph-connections" viewBox="0 0 1000 570" preserveAspectRatio="none" aria-hidden="true">
        <defs><marker id="edge-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="m0 0 6 3-6 3z" fill="currentColor" /></marker></defs>
        {scenario.decisions.slice(0, 3).map((decision, index) => {
          const y = positions[index] * 5.7;
          const isAffected = revisionVisible && affected.has(decision.id);
          const decisionRefs = normalizedRefs(decision.sourceRefs);
          if (!decisionRefs.length) return null;
          return <g key={decision.id} className={`graph-path ${isAffected ? "changed" : ""} ${approvedVisible && affected.has(decision.id) ? "resolved" : ""}`}><path d={`M 295 279 C 335 279, 335 ${y}, 383 ${y}`} markerEnd="url(#edge-arrow)" />{reviewTasks.slice(0, 3).map((review, reviewIndex) => {
            if (!normalizedRefs(review.sourceRefs).some((reference) => decisionRefs.includes(reference))) return null;
            const reviewY = positions[reviewIndex] * 5.7;
            return <path key={review.id} d={`M 625 ${y} C 660 ${y}, 665 ${reviewY}, 700 ${reviewY}`} markerEnd="url(#edge-arrow)" />;
          })}</g>;
        })}
        <circle className="graph-junction" cx="295" cy="279" r="4" />
      </svg>
      <button className={`graph-node source-node ${selection.kind === "clause" ? "selected" : ""} ${revisionVisible ? "changed" : ""}`} style={{ left: "5.5%", top: "49%" }} onClick={() => onSelect({ kind: "clause", id: scenario.clauses[0].id })}>
        <span className="node-kind"><span className="node-icon document-icon"><Icon name="document" size={17} /></span>{revisionVisible ? "取り込んだ改訂" : "判断の根拠"}</span>
        <strong>{scenario.revision.documentTitle}</strong>
        <span className="source-version"><span>{scenario.revision.beforeVersion}</span>{revisionVisible && <><Icon name="arrow" size={13} /><b>{scenario.revision.afterVersion}</b></>}</span>
        <span className="node-bottom">{revisionVisible ? <><span className="change-indicator" />{scenario.clauses.length} つの条項が変更</> : <><Icon name="check" size={12} />参照中の版</>}</span>
      </button>
      {scenario.decisions.slice(0, 3).map((decision, index) => {
        const changed = revisionVisible && affected.has(decision.id);
        const updated = approvedVisible && affected.has(decision.id);
        const snapshot = updated ? [...state.snapshots].reverse().find((item) => item.decisionId === decision.id && item.supersedes) : null;
        return <button key={decision.id} className={`graph-node decision-node ${selection.kind === "decision" && selection.id === decision.id ? "selected" : ""} ${changed ? "changed" : ""} ${updated ? "resolved" : ""}`} style={{ left: "38.3%", top: `${positions[index]}%` }} onClick={() => onSelect({ kind: "decision", id: decision.id })}>
          <span className="node-kind"><Icon name="link" size={13} />{decision.owner}</span>
          <strong>{decision.title}</strong>
          <span className="node-outcome">{snapshot?.outcome ?? decision.outcome}</span>
          <span className="node-bottom">{updated ? <><Icon name="check" size={12} />根拠を更新済み</> : changed ? <><span className="change-indicator" />根拠の再確認が必要</> : <><Icon name="check" size={12} />{revisionVisible ? "変更なし" : "確認済み"}</>}</span>
        </button>;
      })}
      {reviewTasks.slice(0, 3).map((review, index) => {
        const checked = replayIndex === null ? state.reviews[review.id] === "acknowledged" : approvedVisible || events.some((event) => event.type === "review" && (event.detail.includes(review.label) || event.title.includes(review.label)));
        return <button key={review.id} className={`graph-node review-node ${selection.kind === "review" && selection.id === review.id ? "selected" : ""} ${checked ? "checked" : ""} ${!revisionVisible ? "dormant" : ""}`} style={{ left: "70.3%", top: `${positions[index]}%` }} onClick={() => onSelect({ kind: "review", id: review.id })}>
          <span className="review-node-header"><span className={`person-avatar person-${index}`}>{review.initials}</span><span><strong>{review.label}</strong><small>{review.person}</small></span>{checked && <span className="review-check"><Icon name="check" size={13} /></span>}</span>
          <span className="review-node-task">{review.task}</span>
          <span className="node-bottom">{!revisionVisible ? "改訂後に確認" : checked ? "確認を記録済み" : "確認待ち"}</span>
        </button>;
      })}
      <div className="map-caption"><span className={`live-marker ${replayIndex !== null ? "replaying" : ""}`} /><span>{replayIndex !== null ? "履歴を表示中" : approvedVisible ? "更新後のつながり" : revisionVisible ? "改訂後のつながり" : "改訂前のつながり"}</span></div>
    </div>
  </div>;
}

function HistoryReplay({ scenario, state, replayIndex, onReplay }: { scenario: Scenario; state: CaseState; replayIndex: number | null; onReplay: (index: number | null) => void }) {
  const index = replayIndex ?? state.history.length - 1;
  const event = state.history[index];
  return <div className="history-replay">
    <div className="replay-label"><Icon name="history" size={16} /><strong>判断の履歴</strong><span>{state.history.length} 件</span></div>
    <div className="replay-control">
      <input type="range" min={0} max={Math.max(0, state.history.length - 1)} value={index} disabled={state.history.length < 2} aria-label="判断の履歴を再生" aria-valuetext={event?.title ?? "最初の判断"} onChange={(event) => onReplay(Number(event.target.value))} />
      <div className="replay-meta"><span>{event?.title ?? `${scenario.revision.beforeVersion} の判断`}</span><time>{event ? formatTime(event.at) : ""}</time></div>
    </div>
    <button className={`replay-live ${replayIndex === null ? "active" : ""}`} onClick={() => onReplay(null)} disabled={replayIndex === null}>現在</button>
  </div>;
}

function EvidencePanel({ scenario, state, selection, dispatch, onSelect, onNavigate, notify }: { scenario: Scenario; state: CaseState; selection: Selection; dispatch: Dispatch; onSelect: (selection: Selection) => void; onNavigate: (tab: Tab) => void; notify: (message: string) => void }) {
  const [panelTab, setPanelTab] = useState<"source" | "search">("source");
  const selectedClause = scenario.clauses.find((item) => item.id === selection.id) ?? scenario.clauses[0];
  const selectedDecision = scenario.decisions.find((item) => item.id === selection.id) ?? scenario.decisions[0];
  const selectedReview = getReviewTasks(scenario, state).find((item) => item.id === selection.id) ?? getReviewTasks(scenario, state)[0];
  const candidate = scenario.candidates.find((item) => item.id === selection.id);
  const sourceDocument = scenario.documents.find((item) => item.id === selection.id);
  const decisionAffected = getImpacts(scenario).some((impact) => impact.applies && impact.decisions.some((decision) => decision.id === selectedDecision.id));
  const selectedSnapshot = state.approved && decisionAffected ? [...state.snapshots].reverse().find((snapshot) => snapshot.decisionId === selectedDecision.id && snapshot.supersedes) : null;
  return <aside className="evidence-panel" aria-label="選択した項目の詳細">
    <div className="evidence-tabs"><button className={panelTab === "source" ? "active" : ""} onClick={() => setPanelTab("source")}><Icon name="document" size={15} />詳細と根拠</button><button className={panelTab === "search" ? "active" : ""} onClick={() => setPanelTab("search")}><Icon name="spark" size={15} />関連する情報</button></div>
    <div className="evidence-scroll">
      {panelTab === "search" ? <EvidenceSearch scenario={scenario} state={state} dispatch={dispatch} notify={notify} /> : <>
        {selection.kind === "clause" && <>
          <div className="detail-heading"><span className="detail-kind">仕様書の条項</span><h3>{selectedClause.title}</h3><p>{scenario.revision.documentTitle}</p></div>
          <div className="source-paper">
            <div className="source-paper-header"><Icon name="document" size={15} /><strong>{state.revisionApplied ? scenario.revision.afterVersion : scenario.revision.beforeVersion}</strong><span>{state.revisionApplied ? selectedClause.afterRef : selectedClause.beforeRef}</span></div>
            <p>{state.revisionApplied ? selectedClause.after : selectedClause.before}</p>
            <div className="source-paper-foot"><Icon name="link" size={12} />引用元の本文</div>
          </div>
          {state.revisionApplied ? <div className="change-summary"><span><Icon name="warning" size={14} />変わったこと</span><p>{selectedClause.reason}</p><button className="text-button" onClick={() => onNavigate("sources")}>改訂前と比較する<Icon name="arrow" size={14} /></button></div> : <div className="incoming-note"><Icon name="plus" size={16} /><div><strong>{scenario.revision.afterVersion} が届いています</strong><p>「改訂を取り込む」で、判断への影響を確認できます。</p></div></div>}
          <div className="detail-section"><h4>適用条件</h4><div className="condition-row"><span>対象</span><strong>{selectedClause.applicability.productCodes.join("、")}</strong></div><div className="condition-row"><span>適用開始</span><strong>{selectedClause.applicability.effectiveFrom}</strong></div><p className="detail-help">{selectedClause.applicability.explanation}</p></div>
          <div className="detail-section"><h4>つながる判断</h4>{scenario.decisions.filter((decision) => decision.sourceRefs.some((reference) => [selectedClause.beforeRef, selectedClause.afterRef, selectedClause.id].includes(reference))).map((decision) => <button className="reference-row" key={decision.id} onClick={() => onSelect({ kind: "decision", id: decision.id })}><Icon name="link" size={14} /><span>{decision.title}</span><Icon name="chevron" size={14} /></button>)}</div>
          {scenario.clauses.length > 1 && <div className="detail-section"><h4>ほかの変更条項</h4>{scenario.clauses.filter((clause) => clause.id !== selectedClause.id).map((clause) => <button className="reference-row" key={clause.id} onClick={() => onSelect({ kind: "clause", id: clause.id })}><Icon name="document" size={14} /><span>{clause.title}</span><Icon name="chevron" size={14} /></button>)}</div>}
        </>}
        {selection.kind === "decision" && <>
          <div className="detail-heading"><span className="detail-kind">判断</span><h3>{selectedDecision.title}</h3><p>{selectedDecision.owner}</p></div>
          <div className={`decision-detail-status ${state.revisionApplied && !state.approved && decisionAffected ? "needs-review" : ""}`}>{decisionAffected ? <Status state={state} /> : <span className="status-badge approved"><Icon name="check" size={13} />{state.revisionApplied ? "変更なし" : "承認済み"}</span>}<p>{selectedSnapshot?.outcome ?? selectedDecision.outcome}</p></div>
          {state.revisionApplied && decisionAffected && <div className="change-summary"><span><Icon name={state.approved ? "check" : "warning"} size={14} />{state.approved ? "以前の判断を履歴に保存" : "判断の根拠が変わりました"}</span><p>{state.approved ? "新しい対応案と根拠で判断を更新しています。以前の回答は削除せず、履歴から確認できます。" : "この判断は改訂前の文書を参照しています。新しい条件を確認し、必要な対応を選んでください。"}</p></div>}
          {state.revisionApplied && !decisionAffected && <p className="detail-help">変更された条項への参照がないため、この判断は変更されません。既存の根拠と回答を保持しています。</p>}
          <div className="detail-section"><h4>参照している条項</h4>{scenario.clauses.filter((clause) => selectedDecision.sourceRefs.some((reference) => [clause.beforeRef, clause.afterRef, clause.id].includes(reference))).map((clause) => <button className="reference-row" key={clause.id} onClick={() => onSelect({ kind: "clause", id: clause.id })}><Icon name="document" size={14} /><span>{clause.title}<small>{state.revisionApplied ? clause.afterRef : clause.beforeRef}</small></span><Icon name="chevron" size={14} /></button>)}</div>
          <button className="button secondary wide" onClick={() => onNavigate("decision")}>対応案を比較する<Icon name="arrow" size={15} /></button>
          <div className="detail-section"><h4>残っている判断の記録</h4>{state.snapshots.filter((snapshot) => snapshot.decisionId === selectedDecision.id).map((snapshot) => <div className="snapshot-entry" key={snapshot.id}><span>{formatTime(snapshot.at)}</span><p>{snapshot.outcome}</p><small>{snapshot.author}</small></div>)}</div>
        </>}
        {selection.kind === "review" && <>
          <div className="detail-heading"><span className="detail-kind">担当者の確認</span><h3>{selectedReview.label}</h3><p>{selectedReview.person}</p></div>
          <div className="review-task-detail"><span className="detail-label">確認すること</span><p>{selectedReview.task}</p></div>
          <div className="detail-section"><h4>確認後に残す内容</h4><p className="confirmation-copy">{selectedReview.confirmation}</p></div>
          <div className="detail-section"><h4>確認する根拠</h4>{scenario.clauses.filter((clause) => selectedReview.sourceRefs.some((reference) => [clause.beforeRef, clause.afterRef, clause.id].includes(reference))).map((clause) => <button className="reference-row" key={clause.id} onClick={() => onSelect({ kind: "clause", id: clause.id })}><Icon name="document" size={14} /><span>{clause.title}</span><Icon name="chevron" size={14} /></button>)}{scenario.documents.filter((document) => selectedReview.sourceRefs.includes(`DOC:${document.id}`)).map((document) => <button className="reference-row" key={document.id} onClick={() => onSelect({ kind: "document", id: document.id })}><Icon name="document" size={14} /><span>{document.title}<small>{document.version}</small></span><Icon name="chevron" size={14} /></button>)}</div>
          {!state.selectedOptionId && state.revisionApplied && <button className="button secondary wide" onClick={() => onNavigate("decision")}>先に対応案を選ぶ<Icon name="arrow" size={15} /></button>}
          <button className={`button ${state.reviews[selectedReview.id] === "acknowledged" ? "confirmed" : "primary"} wide`} disabled={!state.revisionApplied || !state.selectedOptionId || state.reviews[selectedReview.id] === "acknowledged" || state.approved} onClick={() => { dispatch({ type: "acknowledge-review", caseId: scenario.id, reviewId: selectedReview.id }); notify(`${selectedReview.label}の確認を記録しました。`); }}><Icon name="check" size={16} />{state.reviews[selectedReview.id] === "acknowledged" ? "確認を記録済み" : "内容を確認して記録"}</button>
          <p className="detail-help">{state.selectedOptionId ? "選択した対応案について、各担当者の確認を操作できます。" : state.revisionApplied ? "先に対応案を選ぶと、その案に合わせた確認を記録できます。" : "改訂を取り込むと、確認を始められます。"}</p>
        </>}
        {selection.kind === "document" && sourceDocument && <><div className="detail-heading"><span className="detail-kind">案件の資料</span><h3>{sourceDocument.title}</h3><p>{sourceDocument.tag}</p></div><div className="source-paper"><div className="source-paper-header"><Icon name="document" size={15} /><strong>{sourceDocument.version}</strong><span>DOC:{sourceDocument.id}</span></div><p>{sourceDocument.text}</p><div className="source-paper-foot"><Icon name="link" size={12} />引用元の本文</div></div><button className="button secondary wide source-back-button" onClick={() => onNavigate("decision")}>確認・引き継ぎへ戻る<Icon name="arrow" size={15} /></button></>}
        {selection.kind === "candidate" && candidate && <>
          <div className="detail-heading"><span className="detail-kind">関連候補</span><h3>{candidate.title}</h3><p>{candidate.sourceRef}</p></div><div className="source-paper"><p>{candidate.text}</p></div><p className="detail-help">{candidate.note}</p>
        </>}
        <div className="explore-related"><Icon name="spark" size={18} /><div><strong>見落とした情報はありませんか？</strong><p>関連する過去案件や手順を探せます。</p></div><button className="icon-button" aria-label="関連する情報を検索" onClick={() => setPanelTab("search")}><Icon name="arrow" size={17} /></button></div>
      </>}
    </div>
  </aside>;
}

function EvidenceSearch({ scenario, state, dispatch, notify }: { scenario: Scenario; state: CaseState; dispatch: Dispatch; notify: (message: string) => void }) {
  const [query, setQuery] = useState(scenario.revision.query);
  const [method, setMethod] = useState<Method>("lexical");
  const [ranked, setRanked] = useState<{ id: string; score: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<{ text: string; mode: string; citations: string[] } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [searchedMethod, setSearchedMethod] = useState<Method | null>(null);
  const runId = useRef(0);
  async function search(nextMethod = method) {
    if (!query.trim()) { setError("探したい内容を入力してください。"); return; }
    const id = ++runId.current;
    setLoading(true);
    setError("");
    setExplanation(null);
    try {
      if (nextMethod === "trained") await initializeModel();
      const results = await rankCandidates(query, scenario.candidates.map((candidate) => ({ id: candidate.id, text: `${candidate.title} ${candidate.text}` })), nextMethod);
      if (id !== runId.current) return;
      setRanked(results);
      setLatency(getLastInference()?.elapsedMs ?? null);
      setBackend(getLastInference()?.backend ?? null);
      setSearchedMethod(nextMethod);
    } catch (cause) {
      if (id !== runId.current) return;
      setError(`検索を実行できませんでした。${cause instanceof Error ? cause.message : "もう一度お試しください。"}`);
    } finally { if (id === runId.current) setLoading(false); }
  }
  async function explain() {
    setExplaining(true);
    try {
      const evidence = ranked.slice(0, 3).flatMap((result) => {
        const candidate = scenario.candidates.find((item) => item.id === result.id);
        return candidate ? [{ id: candidate.id, text: candidate.text }] : [];
      });
      const response = await fetch("/api/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, evidence, caseTitle: scenario.title }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { text: string; mode: string; citations: string[] };
      setExplanation(data);
    } catch { setError("根拠の整理を取得できませんでした。検索結果の本文はそのまま確認できます。"); }
    finally { setExplaining(false); }
  }
  return <div className="evidence-search">
    <div className="detail-heading"><span className="detail-kind">根拠を探す</span><h3>関連する情報</h3><p>改訂内容に近い過去案件や手順を、読む順に並べます。</p></div>
    <label className="query-label" htmlFor="evidence-query">確かめたいこと</label>
    <textarea id="evidence-query" className="evidence-query" value={query} onChange={(event) => setQuery(event.target.value)} rows={3} />
    <label className="query-label" htmlFor="search-method">並べ替えの方法</label>
    <select id="search-method" className="method-select" value={method} onChange={(event) => setMethod(event.target.value as Method)}>
      <option value="lexical">BM25 文字 n-gram</option><option value="trained">PyTorch 学習済み実験モデル</option><option value="embedding">未学習・固定ランダム埋め込み</option>
    </select>
    <button className="button primary wide" onClick={() => { void search(); }} disabled={loading}><Icon name={loading ? "history" : "search"} size={15} />{loading ? "関連情報を検索中…" : "関連情報を検索"}</button>
    {method === "embedding" && <p className="detail-help">比較用の未学習モデルです。事前学習済みの意味検索ではありません。</p>}
    {method === "trained" && <p className="detail-help">今回の保持テストではBM25が上回りました。学習済みモデルは比較実験として試せます。</p>}
    {error && <p className="inline-error" role="alert"><Icon name="warning" size={14} />{error}</p>}
    {ranked.length > 0 && <>
      <div className="search-result-heading"><strong>{ranked.length} 件の候補</strong><span>{searchedMethod && methodNames[searchedMethod]}{latency !== null ? ` / ${latency.toFixed(1)} ms` : ""}{backend ? ` / ${backend === "wasm" ? "WASM" : "JavaScript"}` : ""}</span></div>
      <p className="candidate-caution">関連度は方法ごとの相対スコアです。正解の確率ではありません。本文と適用条件を確認してください。</p>
      <div className="ranked-results">{ranked.map((result, index) => {
        const candidate = scenario.candidates.find((item) => item.id === result.id);
        if (!candidate) return null;
        const disposition = state.candidates[candidate.id] ?? "suggested";
        const document = scenario.documents.find((item) => candidate.sourceRef === `DOC:${item.id}`);
        return <article className={`candidate-item ${disposition}`} data-score={result.score} key={candidate.id}><div className="candidate-title"><span className="rank-number">{index + 1}</span><h4>{candidate.title}</h4></div><span className="candidate-ref">{candidate.sourceRef}{document ? ` / ${document.version}` : ""}<span className="candidate-score">関連度 {result.score.toFixed(3)}</span></span><p>{candidate.text}</p><details><summary>確認時の注意</summary><p>{candidate.note}</p></details><div className="candidate-actions">{disposition === "suggested" ? <><button disabled={!state.revisionApplied || state.approved} onClick={() => { dispatch({ type: "accept-candidate", caseId: scenario.id, candidateId: candidate.id }); notify("候補を確認対象に追加しました。判断の自動承認は行いません。"); }}><Icon name="plus" size={13} />確認対象に加える</button><button disabled={!state.revisionApplied || state.approved} onClick={() => { dispatch({ type: "reject-candidate", caseId: scenario.id, candidateId: candidate.id }); }}>対象外にする</button></> : <span><Icon name={disposition === "accepted" ? "check" : "close"} size={13} />{disposition === "accepted" ? "確認対象に追加済み" : "対象外として記録"}</span>}</div></article>;
      })}</div>
      <div className="explain-section"><button className="button secondary wide" disabled={explaining} onClick={() => { void explain(); }}><Icon name="spark" size={15} />{explaining ? "根拠を整理中…" : "上位の根拠を整理する"}</button>{explanation && <div className="explanation-result"><span>{explanation.mode === "generated" ? "AIによる整理" : "本文からの抜粋"}</span><p>{explanation.text}</p><small>参照: {explanation.citations.join("、") || "検索結果"}</small>{explanation.mode !== "generated" && <small>生成AIを利用できないため、引用元の本文を表示しています。</small>}</div>}</div>
    </>}
    {!ranked.length && !loading && <div className="search-empty"><span className="search-empty-symbol"><Icon name="link" size={24} /></span><strong>過去の知見を、今回の判断へ。</strong><p>同じ資料を、異なる検索方法で比較できます。順位の違いも確かめてみてください。</p></div>}
  </div>;
}

function DeltaText({ before, after, version }: { before: string; after: string; version: "before" | "after" }) {
  let start = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  let end = 0;
  while (end < Math.min(before.length, after.length) - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const text = version === "before" ? before : after;
  if (before === after) return <>{text}</>;
  return <>{text.slice(0, start)}<mark>{text.slice(start, text.length - end)}</mark>{end ? text.slice(-end) : ""}</>;
}

function SourcesView({ scenario, state, onApply, onSelect }: { scenario: Scenario; state: CaseState; onApply: () => void; onSelect: (selection: Selection) => void }) {
  return <div className="sources-view">
    <SectionHeading description="変わった本文と適用条件を確認します。条項から、参照している判断へ戻れます。" action={<span className="source-count">{scenario.clauses.length} 条項の変更</span>}>根拠と差分</SectionHeading>
    {!state.revisionApplied && <div className="pending-revision-banner"><Icon name="info" size={18} /><p>改訂版のプレビューです。取り込むと、関連する判断が再確認の対象になります。</p><button className="button primary small" onClick={onApply}>改訂を取り込む</button></div>}
    <div className="comparison-document-title"><Icon name="document" size={22} /><div><h3>{scenario.revision.documentTitle}</h3><p>{scenario.revision.summary}</p></div></div>
    {scenario.clauses.map((clause, index) => <article className="clause-comparison" key={clause.id}>
      <div className="clause-heading"><span className="clause-index">{String(index + 1).padStart(2, "0")}</span><h3>{clause.title}</h3><button className="text-button" onClick={() => onSelect({ kind: "clause", id: clause.id })}>判断とのつながりを見る<Icon name="arrow" size={14} /></button></div>
      <div className="diff-columns"><div className="diff-panel before"><header><span>改訂前</span><strong>{scenario.revision.beforeVersion}</strong><small>{clause.beforeRef}</small></header><p><DeltaText before={clause.before} after={clause.after} version="before" /></p></div><div className="diff-panel after"><header><span>改訂後</span><strong>{scenario.revision.afterVersion}</strong><small>{clause.afterRef}</small></header><p><DeltaText before={clause.before} after={clause.after} version="after" /></p></div></div>
      <div className="clause-reason"><Icon name="link" size={15} /><span>{clause.reason}</span></div>
      <div className="applicability-strip"><span>適用条件</span><strong>{clause.applicability.productCodes.join("、")}</strong><span>{clause.applicability.effectiveFrom} 以降</span><p>{clause.applicability.explanation}</p></div>
    </article>)}
    <div className="document-library"><h3>案件に含まれる資料</h3><div>{scenario.documents.map((document) => <details key={document.id} className="library-document"><summary><Icon name="document" size={17} /><span><strong>{document.title}</strong><small>{document.version} / {document.tag}</small></span><Icon name="chevron" size={14} /></summary><p>{document.text}</p></details>)}</div></div>
  </div>;
}

function DecisionView({ scenario, state, dispatch, onApprove, onApply, notify, onShowSource }: { scenario: Scenario; state: CaseState; dispatch: Dispatch; onApprove: () => void; onApply: () => void; notify: (message: string) => void; onShowSource: (selection: Selection) => void }) {
  const gate = getApprovalGate(scenario, state);
  const selectedOption = scenario.options.find((option) => option.id === state.selectedOptionId);
  return <div className="decision-view">
    <SectionHeading description="対応案を選び、各担当の確認をそろえて、新しい判断を記録します。" action={<Status state={state} />}>判断して、次の人へ。</SectionHeading>
    {!state.revisionApplied && <div className="pending-revision-banner"><Icon name="info" size={18} /><p>まず改訂を取り込んで、確認と対応案の比較を始めてください。</p><button className="button primary small" onClick={onApply}>改訂を取り込む</button></div>}
    {state.approved && <div className="approval-success"><span><Icon name="check" size={24} /></span><div><h3>根拠と回答を更新しました。</h3><p>{selectedOption ? `${selectedOption.title}を選択。納期 ${formatDate(selectedOption.deliveryDate)} として、判断履歴に保存しました。` : "確認内容と対応案を判断履歴に保存しました。"}</p></div><button className="button secondary small" onClick={() => downloadFile(`reframe-${scenario.order.id}-handoff.json`, JSON.stringify({ order: scenario.order, option: selectedOption, reviews: scenario.reviews.filter((review) => state.reviews[review.id] === "acknowledged"), snapshots: state.snapshots, history: state.history }, null, 2))}><Icon name="download" size={14} />引き継ぎを書き出す</button></div>}
    <div className="section-step-heading"><span>1</span><h3>部門ごとの確認</h3><p>{scenario.reviews.filter((review) => state.reviews[review.id] === "acknowledged").length}/{scenario.reviews.length} 件を確認済み</p></div>
    <div className="review-grid">{getReviewTasks(scenario, state).map((review, index) => {
      const checked = state.reviews[review.id] === "acknowledged";
      return <article className={`review-card ${checked ? "checked" : ""}`} key={review.id}><header><span className={`person-avatar person-${index}`}>{review.initials}</span><div><h4>{review.label}</h4><span>{review.person}</span></div>{checked && <Icon name="check" size={18} />}</header><p>{review.task}</p><button className="text-button" onClick={() => onShowSource({ kind: "review", id: review.id })}>根拠を確認<Icon name="arrow" size={13} /></button><div className="confirmation-text"><Icon name="document" size={13} /><span>{review.confirmation}</span></div><button className={`button ${checked ? "confirmed" : "secondary"} wide`} disabled={!state.revisionApplied || checked || state.approved} onClick={() => { dispatch({ type: "acknowledge-review", caseId: scenario.id, reviewId: review.id }); notify(`${review.label}の確認を記録しました。`); }}><Icon name="check" size={14} />{checked ? "確認を記録済み" : "内容を確認して記録"}</button></article>;
    })}</div>
    <div className="section-step-heading"><span>2</span><h3>対応案を選ぶ</h3><p>数量・日付・制約は、登録済みの条件で比較</p></div>
    <div className="options-list">{scenario.options.map((option) => <button key={option.id} className={`option-card ${state.selectedOptionId === option.id ? "selected" : ""} ${!option.feasible ? "infeasible" : ""}`} disabled={!state.revisionApplied || !option.feasible || state.approved} onClick={() => dispatch({ type: "select-option", caseId: scenario.id, optionId: option.id })} aria-pressed={state.selectedOptionId === option.id}>
      <span className="option-radio">{state.selectedOptionId === option.id && <span />}</span><div className="option-main"><h4>{option.title}{!option.feasible && <span className="unavailable-label">選択不可</span>}</h4><p>{option.description}</p><span className="option-tradeoff">{option.feasible ? option.tradeoff : option.infeasibleReason}</span><div className="option-conditions">{option.conditions.map((condition) => <span key={condition}><Icon name={option.feasible ? "check" : "close"} size={11} />{condition}</span>)}</div></div><div className="option-numbers"><span>納期<strong>{formatDate(option.deliveryDate)}</strong></span><span>追加費用<strong>{option.addedCost ? `¥${option.addedCost.toLocaleString()}` : "なし"}</strong></span><span>追加工数<strong>{option.addedHours}<small> h</small></strong></span></div>
    </button>)}</div>
    <div className={`approval-bar ${state.approved ? "complete" : ""}`}><div><h3><Icon name={state.approved ? "check" : "shield"} size={18} />{state.approved ? "この案件の判断を更新済み" : "根拠を確認して、判断を更新"}</h3><p>{state.approved ? "以前の回答と参照元は、履歴に保存されています。" : gate.canApprove ? "担当者の確認と対応案がそろいました。" : gate.reasons.join(" / ")}</p></div><button className="button primary" disabled={!gate.canApprove || state.approved} onClick={onApprove}><Icon name="check" size={17} />{state.approved ? "判断を更新済み" : "この内容で判断を更新"}</button></div>
    <div className="decision-history"><h3><Icon name="history" size={17} />変更と判断の記録</h3>{[...state.history].reverse().map((event) => <div className={`audit-event audit-${event.type}`} key={event.id}><span className="audit-dot" /><time>{formatTime(event.at)}</time><div><strong>{event.title}</strong><p>{event.detail}</p></div><span className="audit-actor">{event.actor}</span></div>)}</div>
  </div>;
}

function EvaluationLab() {
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");
  const [activeMetric, setActiveMetric] = useState<"ndcgAt5" | "recallAt5" | "mrr" | "top1">("ndcgAt5");
  const modelStatus = getModelStatus();
  useEffect(() => {
    let cancelled = false;
    fetch("/evaluation/metrics.json").then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.json() as Evaluation; }).then((data) => {
      if (!data.metrics?.trained || !data.metrics?.lexical || !data.metrics?.embedding) throw new Error("評価結果の形式を確認できません");
      if (!cancelled) setEvaluation(data);
    }).catch(() => { if (!cancelled) setError("評価結果を読み込めませんでした。ページを再読み込みしてください。"); });
    return () => { cancelled = true; };
  }, []);
  const metricNames = { ndcgAt5: "上位5件の並び方", recallAt5: "上位5件の拾い上げ", mrr: "最初の正解の順位", top1: "1位の正解率" };
  return <div className="evaluation-view">
    <SectionHeading description="検索方法を同じ条件で比較。学習と評価を、再実行できる形で公開しています。" action={<a className="button secondary small" href="/evaluation/metrics.json" target="_blank" rel="noreferrer"><Icon name="download" size={14} />評価データを見る</a>}>精度を、確かめる。</SectionHeading>
    <div className="evaluation-intro"><div className="lab-symbol"><Icon name="lab" size={28} /></div><div><h3>候補を見つける、小さな学習モデル。</h3><p>文書の関連性を学習し、読む順序を改善できるか比較します。業務上の適用判断や承認は、モデルのスコアから決定しません。</p></div></div>
    {error && <div className="inline-error" role="alert"><Icon name="warning" size={18} />{error}</div>}
    {!evaluation && !error && <div className="evaluation-loading"><span className="loading-ring" />保存された評価結果を読み込んでいます。</div>}
    {evaluation && <>
      <div className="evaluation-data-note"><Icon name="info" size={17} /><p><strong>自己作成の架空データによる評価です。</strong>16の共通テーマ内で、学習とは別のシナリオ48問をテストに使用しています。同じ案件の言い換えは分割をまたぎません。実際の工場や未知のテーマへの精度を示すものではありません。</p></div>
      <div className="benchmark-finding"><Icon name="lab" size={18} /><p><strong>{evaluation.metrics.lexical.ndcgAt5 > evaluation.metrics.trained.ndcgAt5 ? "今回は、キーワード検索が学習済みモデルを上回りました。" : "今回は、学習済みモデルがキーワード検索を上回りました。"}</strong>検索の既定値は保持テストで良かった方法に合わせています。学習結果もそのまま公開し、改善点を確かめられるようにしています。</p></div>
      <div className="evaluation-grid"><section className="evaluation-chart">
        <div className="chart-heading"><div><h3>同じ問い、異なる並べ方。</h3><span>保持したテスト集合での比較</span></div><select aria-label="比較する評価指標" value={activeMetric} onChange={(event) => setActiveMetric(event.target.value as typeof activeMetric)}>{Object.entries(metricNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
        <div className="metric-scale"><span>0</span><span>0.25</span><span>0.5</span><span>0.75</span><span>1.0</span></div>
        <div className="metric-bars">{(["trained", "lexical", "embedding"] as Method[]).map((method) => <div className={`metric-row metric-${method}`} key={method}><div className="metric-row-label"><strong>{methodNames[method]}</strong><span>{method === "trained" ? "PyTorch" : method === "lexical" ? "BM25 文字 n-gram" : "固定ランダム・比較用"}</span></div><div className="metric-track"><span style={{ width: `${Math.max(0, Math.min(1, evaluation.metrics[method][activeMetric])) * 100}%` }} /><strong>{evaluation.metrics[method][activeMetric].toFixed(3)}</strong></div></div>)}</div>
        <p className="metric-description">{activeMetric === "ndcgAt5" ? "nDCG@5：関連性の高い資料ほど上に並ぶと高くなります。" : activeMetric === "recallAt5" ? "Recall@5：正解資料のうち、上位5件で拾えた割合です。" : activeMetric === "mrr" ? "MRR：最初の正解が上にあるほど高くなります。" : "Top-1：最上位の候補が正解である割合です。"}いずれも 1 に近いほど良い指標です。</p>
      </section><aside className="model-sheet"><span className="model-sheet-label">公開しているモデル</span><h3>{evaluation.model.name}</h3><p>{evaluation.model.architecture}</p><dl><div><dt>パラメータ</dt><dd>{evaluation.model.parameterCount.toLocaleString()}</dd></div><div><dt>ONNXサイズ</dt><dd>{(evaluation.model.onnxBytes / 1024).toFixed(1)} KB</dd></div><div><dt>学習エポック</dt><dd>{evaluation.training.epochs}</dd></div><div><dt>選択エポック</dt><dd>{evaluation.training.bestEpoch}</dd></div><div><dt>乱数シード</dt><dd>{evaluation.training.seed}</dd></div><div><dt>学習時間</dt><dd>{evaluation.training.durationSeconds.toFixed(1)} 秒</dd></div></dl><span className={`runtime-status ${modelStatus.ready ? "ready" : ""}`}><i />{modelStatus.ready ? "ブラウザでモデルを読み込み済み" : "関連情報の検索時にモデルを読み込み"}</span></aside></div>
      <div className="evaluation-table-wrap"><table className="evaluation-table"><caption>検索精度と推論時間の比較</caption><thead><tr><th scope="col">方法</th><th scope="col">nDCG@5</th><th scope="col">Recall@5</th><th scope="col">MRR</th><th scope="col">Top-1</th><th scope="col">中央値</th><th scope="col">p95</th></tr></thead><tbody>{(["trained", "lexical", "embedding"] as Method[]).map((method) => <tr key={method} className={method === "trained" ? "highlight" : ""}><th scope="row">{methodNames[method]}</th><td>{evaluation.metrics[method].ndcgAt5.toFixed(3)}</td><td>{evaluation.metrics[method].recallAt5.toFixed(3)}</td><td>{evaluation.metrics[method].mrr.toFixed(3)}</td><td>{evaluation.metrics[method].top1.toFixed(3)}</td><td>{evaluation.metrics[method].medianMs.toFixed(2)} ms</td><td>{evaluation.metrics[method].p95Ms.toFixed(2)} ms</td></tr>)}</tbody></table><p>時間は評価を実行した環境での測定です。ブラウザ上の検索時間は「関連する情報」で別に実測します。</p></div>
      <div className="evaluation-bottom"><section><h3>データの分け方</h3><div className="split-diagram">{([{ label: "学習", count: evaluation.data.trainQueries, className: "train" }, { label: "検証", count: evaluation.data.devQueries, className: "dev" }, { label: "テスト", count: evaluation.data.testQueries, className: "test" }]).map((item) => <div className={item.className} key={item.label}><span>{item.label}</span><strong>{item.count.toLocaleString()}</strong><small>クエリ</small></div>)}</div><p>{evaluation.data.source}</p><p className="parity-note">PyTorchとONNXの出力差: {evaluation.parity.maxAbsoluteError.toExponential(2)} / 許容差 {evaluation.parity.tolerance.toExponential(2)}</p></section><section><h3>この評価で分からないこと</h3><ul>{evaluation.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul><p className="evaluation-date">評価日時: {formatTime(evaluation.evaluatedAt)}</p></section></div>
      <div className="reproduce-note"><Icon name="lab" size={19} /><div><strong>結果だけでなく、確かめる手順も。</strong><p>学習コード、データ生成、評価、ONNXへの書き出しをリポジトリにまとめています。</p></div><a className="button secondary small" href="https://github.com/kandotrun/reframe/tree/main/ml" target="_blank" rel="noreferrer">学習コードを見る<Icon name="arrow" size={13} /></a></div>
    </>}
  </div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const dialog = modalRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex="0"]');
      if (!focusable?.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { document.removeEventListener("keydown", trap); document.body.style.overflow = previousOverflow; before?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="icon-button modal-close" aria-label="閉じる" onClick={onClose}><Icon name="close" size={20} /></button><h2 id="modal-title">{title}</h2>{children}</div></div>;
}
