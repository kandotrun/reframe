import { expect, test, type Page } from "@playwright/test";

const storageKey = "reframe.workspace.v1";
const inspectionTitle = "検査条件が変わった。納期は守れる？";

type Snapshot = {
  id: string;
  decisionId: string;
  outcome: string;
  sourceRefs: string[];
  supersedes?: string;
};
type SavedCase = {
  revisionApplied: boolean;
  approved: boolean;
  reviews: Record<string, string>;
  selectedOptionId: string | null;
  snapshots: Snapshot[];
  history: { type: string; title: string }[];
};
type SavedWorkspace = {
  activeCaseId: string;
  cases: Record<string, SavedCase>;
};

async function savedWorkspace(page: Page): Promise<SavedWorkspace> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error("The workspace was not persisted");
    const parsed = JSON.parse(raw);
    return parsed.workspace ?? parsed;
  }, storageKey);
}

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: inspectionTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "改訂を取り込む", exact: true })).toBeEnabled();
  await expect.poll(async () => (await savedWorkspace(page)).activeCaseId).toBe("inspection");
}

async function applyRevision(page: Page) {
  await page.getByRole("button", { name: "改訂を取り込む", exact: true }).click();
  await expect(page.locator(".case-kicker")).toContainText("再確認が必要");
}

async function openSearch(page: Page) {
  await page.getByRole("tab", { name: "変更の影響", exact: true }).click();
  await page.getByRole("button", { name: "関連する情報", exact: true }).click();
  await expect(page.getByLabel("確かめたいこと")).toBeVisible();
}

async function search(page: Page, method: "trained" | "lexical" | "embedding") {
  await page.getByLabel("並べ替えの方法").selectOption(method);
  await page.getByRole("button", { name: "関連情報を検索", exact: true }).click();
  const names = { trained: "学習済みモデル", lexical: "キーワード検索", embedding: "未学習の埋め込み" };
  await expect(page.locator(".search-result-heading")).toContainText(names[method]);
  await expect(page.locator(".candidate-item")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "関連情報を検索", exact: true })).toBeEnabled();
}

async function readScores(page: Page) {
  const scores = await page.locator(".candidate-item").evaluateAll((items) =>
    items.map((item) => ({
      title: item.querySelector("h4")?.textContent ?? "",
      score: Number(item.getAttribute("data-score") ?? "NaN"),
    })),
  );
  expect(scores).toHaveLength(5);
  expect(scores.every((item) => Number.isFinite(item.score))).toBe(true);
  for (let index = 1; index < scores.length; index++) {
    expect(scores[index - 1]!.score).toBeGreaterThanOrEqual(scores[index]!.score);
  }
  return scores;
}

test("revision, cited differences, gated approval and replay preserve the original judgments", async ({ page }, testInfo) => {
  await openWorkspace(page);
  const original = (await savedWorkspace(page)).cases.inspection!;
  await applyRevision(page);

  const impact = page.getByRole("tabpanel", { name: "変更の影響" });
  const delivery = impact.getByRole("button").filter({ has: page.getByText("納期回答", { exact: true }) }).first();
  const commercial = impact.getByRole("button").filter({ has: page.getByText("単価条件", { exact: true }) });
  await expect(delivery).toContainText("根拠の再確認が必要");
  await expect(commercial).toContainText("契約済みの製品単価を継続");
  await expect(commercial).toContainText("変更なし");
  await expect(commercial).not.toContainText("再確認が必要");
  await expect(impact.locator(".unaffected-note")).toContainText("適用対象外");

  await page.getByRole("tab", { name: "根拠と差分", exact: true }).click();
  const sources = page.getByRole("tabpanel", { name: "根拠と差分" });
  const sampling = sources.getByRole("article").filter({ has: page.getByRole("heading", { name: "4.2 寸法検査の対象", exact: true }) });
  await expect(sampling.locator(".diff-panel.before")).toContainText("SPEC-AX240:R1:4.2");
  await expect(sampling.locator(".diff-panel.before")).toContainText("62個を検査");
  await expect(sampling.locator(".diff-panel.after")).toContainText("SPEC-AX240:R2:4.2");
  await expect(sampling.locator(".diff-panel.after")).toContainText("620個を検査");
  await expect(sampling.locator("mark")).toHaveCount(2);
  const pilot = sources.getByRole("article").filter({ has: page.getByRole("heading", { name: "付録B 試作ロットの識別", exact: true }) });
  await expect(pilot).toContainText("量産品AX-240には適用しない");
  await sampling.getByRole("button", { name: "判断とのつながりを見る" }).click();
  const detail = page.getByRole("complementary", { name: "選択した項目の詳細" });
  await expect(detail.getByRole("heading", { name: "4.2 寸法検査の対象", exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "納期回答", exact: true }).click();
  await expect(detail.getByRole("heading", { name: "納期回答", exact: true })).toBeVisible();
  await expect(detail).toContainText("判断の根拠が変わりました");

  await page.getByRole("tab", { name: "判断・引き継ぎ", exact: true }).click();
  const update = page.getByRole("button", { name: "この内容で判断を更新", exact: true });
  await expect(update).toBeDisabled();
  await expect(page.getByRole("button", { name: /旧来の抜取検査を継続/ })).toBeDisabled();
  await page.getByRole("button", { name: /追加枠を確保して納期を維持/ }).click();
  await expect(update).toBeDisabled();
  for (const [index, name] of ["生産管理", "調達・出荷", "品質保証"].entries()) {
    const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await card.getByRole("button", { name: "内容を確認して記録", exact: true }).click();
    await expect(card.getByRole("button", { name: "確認を記録済み", exact: true })).toBeDisabled();
    if (index < 2) await expect(update).toBeDisabled();
  }
  await expect(update).toBeEnabled();
  await update.click();
  await expect(page.getByRole("heading", { name: "根拠と回答を更新しました。", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "判断を更新済み", exact: true })).toBeDisabled();
  await expect.poll(async () => (await savedWorkspace(page)).cases.inspection!.approved).toBe(true);

  const approved = (await savedWorkspace(page)).cases.inspection!;
  expect(approved.snapshots.slice(0, original.snapshots.length)).toEqual(original.snapshots);
  const additions = approved.snapshots.slice(original.snapshots.length);
  expect(additions.map((snapshot) => snapshot.decisionId).sort()).toEqual(["delivery", "release"]);
  expect(additions.every((snapshot) => original.snapshots.some((old) => old.id === snapshot.supersedes))).toBe(true);
  expect(additions.flatMap((snapshot) => snapshot.sourceRefs)).toContain("SPEC-AX240:R2:4.2");
  expect(approved.history.map((event) => event.type)).toEqual(["initial", "revision", "option", "review", "review", "review", "approval"]);

  await page.getByRole("tab", { name: "変更の影響", exact: true }).click();
  await expect(commercial).toContainText("契約済みの製品単価を継続");
  await expect(commercial).not.toContainText("根拠を更新済み");
  const history = page.getByRole("slider", { name: "判断の履歴を再生" });
  await history.focus();
  await history.press("Home");
  await expect(history).toHaveAttribute("aria-valuetext", "Rev.1 を根拠に判断を確定");
  await expect(delivery).toContainText("10月28日・620個を一括納品");
  await expect(delivery).not.toContainText("根拠の再確認が必要");
  await page.getByRole("button", { name: "現在", exact: true }).click();
  await expect(page.locator(".case-kicker")).toContainText("判断を更新済み");
  await page.reload();
  await expect(page.locator(".case-kicker")).toContainText("判断を更新済み");
  expect((await savedWorkspace(page)).cases.inspection).toEqual(approved);
  await page.screenshot({ path: testInfo.outputPath("approved-workspace.png"), fullPage: true });
});

test("case changes are isolated and reset preserves another case's review history", async ({ page }) => {
  await openWorkspace(page);
  const initial = await savedWorkspace(page);
  await applyRevision(page);
  const sidebar = page.getByRole("complementary", { name: "案件一覧" });
  await sidebar.getByRole("button", { name: /PO-1048/ }).click();
  await expect(page.locator(".case-kicker")).toContainText("承認済み");
  expect((await savedWorkspace(page)).cases.material).toEqual(initial.cases.material);
  await applyRevision(page);
  await page.getByRole("tab", { name: "判断・引き継ぎ", exact: true }).click();
  await page.getByRole("button", { name: /予定証明書を待って照合/ }).click();
  await page.getByRole("article").filter({ has: page.getByRole("heading", { name: "調達", exact: true }) })
    .getByRole("button", { name: "内容を確認して記録", exact: true }).click();
  const material = (await savedWorkspace(page)).cases.material;

  await sidebar.getByRole("button", { name: /PO-1042/ }).click();
  await expect(page.locator(".case-kicker")).toContainText("再確認が必要");
  await page.getByRole("button", { name: "最初から試す", exact: true }).click();
  const reset = page.getByRole("dialog", { name: "この案件を最初から試しますか？" });
  await expect(reset).toContainText("ほかの案件の操作は残ります");
  await reset.getByRole("button", { name: "最初から試す", exact: true }).click();
  await expect(reset).toBeHidden();
  await expect(page.getByRole("button", { name: "改訂を取り込む", exact: true })).toBeVisible();
  const result = await savedWorkspace(page);
  expect(result.cases.inspection).toEqual(initial.cases.inspection);
  expect(result.cases.material).toEqual(material);
  expect(result.cases.packaging).toEqual(initial.cases.packaging);
  await page.reload();
  expect((await savedWorkspace(page)).cases).toEqual(result.cases);
});

test("real WASM ranking responds to input, compares baselines and exposes the saved evaluation", async ({ page }) => {
  test.setTimeout(120_000);
  const modelResponse = page.waitForResponse((response) => response.url().endsWith("/models/relevance.onnx"));
  const wasmResponse = page.waitForResponse((response) => /\/ort\/.*\.wasm$/.test(response.url()));
  await openWorkspace(page);
  await openSearch(page);
  await search(page, "trained");
  expect((await modelResponse).ok()).toBe(true);
  expect((await wasmResponse).ok()).toBe(true);
  expect((await (await modelResponse).body()).length).toBeGreaterThan(128);
  await expect(page.locator(".search-result-heading")).toContainText(/WASM/i);
  const firstScores = await readScores(page);
  await page.getByLabel("確かめたいこと").fill("校正記録 CAL-26-104 測定器 MG-07 有効期限とロットの紐づけ");
  await search(page, "trained");
  const changedScores = await readScores(page);
  expect(changedScores).not.toEqual(firstScores);

  await search(page, "lexical");
  const lexicalScores = await readScores(page);
  await search(page, "embedding");
  const embeddingScores = await readScores(page);
  expect(lexicalScores).not.toEqual(embeddingScores);
  await expect(page.getByText("比較用の未学習モデルです。事前学習済みの意味検索ではありません。")).toBeVisible();
  expect((await savedWorkspace(page)).cases.inspection!.approved).toBe(false);

  const reportResponse = page.waitForResponse((response) => response.url().endsWith("/evaluation/metrics.json"));
  await page.getByRole("tab", { name: "評価ラボ", exact: true }).click();
  const response = await reportResponse;
  expect(response.ok()).toBe(true);
  const report = await response.json();
  expect(report.data.trainQueries).toBeGreaterThan(0);
  expect(report.data.devQueries).toBeGreaterThan(0);
  expect(report.data.testQueries).toBeGreaterThan(0);
  expect(report.parity.maxAbsoluteError).toBeLessThanOrEqual(report.parity.tolerance);
  const table = page.getByRole("table", { name: "検索精度と推論時間の比較" });
  await expect(table).toBeVisible();
  for (const [method, label] of [["trained", "学習済みモデル"], ["lexical", "キーワード検索"], ["embedding", "未学習の埋め込み"]]) {
    await expect(table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) }))
      .toContainText(report.metrics[method!].ndcgAt5.toFixed(3));
  }
  await expect(page.getByText("自己作成の架空データによる評価です。")).toBeVisible();
  await expect(page.getByRole("link", { name: "評価データを見る" })).toHaveAttribute("href", "/evaluation/metrics.json");
  await expect(page.getByRole("link", { name: "学習コードを見る" })).toHaveAttribute("href", "https://github.com/kandotrun/reframe/tree/main/ml");
  await page.getByLabel("比較する評価指標").selectOption("recallAt5");
  await expect(page.locator(".metric-description")).toContainText("Recall@5");
});

test("generative API failure is explicit and leaves real local retrieval usable", async ({ page }) => {
  // Only the optional remote explanation API is simulated. Ranking/model/runtime
  // assets are downloaded and executed normally, as in the other browser tests.
  await page.route("**/api/explain", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "Service unavailable" }),
  }));
  await openWorkspace(page);
  await openSearch(page);
  await search(page, "trained");
  const before = await readScores(page);
  await page.getByRole("button", { name: "上位の根拠を整理する", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("根拠の整理を取得できませんでした");
  await expect(page.getByRole("alert")).toContainText("検索結果の本文はそのまま確認できます");
  expect(await readScores(page)).toEqual(before);
  await expect(page.locator(".candidate-item").first()).toContainText(/DOC:|CASE:|SPEC:|REC:/);
  await expect(page.getByText("AIによる整理", { exact: true })).toHaveCount(0);
  await search(page, "lexical");
});

test("390px mobile keeps the page bounded while all primary panels remain usable @mobile", async ({ page }, testInfo) => {
  await openWorkspace(page);
  async function noPageOverflow() {
    await expect.poll(() => page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))).toEqual({ scroll: 390, viewport: 390 });
  }
  await noPageOverflow();
  await applyRevision(page);
  await noPageOverflow();
  await page.screenshot({ path: testInfo.outputPath("mobile-impact.png"), fullPage: true });
  for (const name of ["根拠と差分", "判断・引き継ぎ", "評価ラボ"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tabpanel", { name })).toBeVisible();
    await noPageOverflow();
  }
  await expect(page.getByRole("table", { name: "検索精度と推論時間の比較" })).toBeVisible();
  await noPageOverflow();
  await page.getByRole("button", { name: "最初から試す", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "この案件を最初から試しますか？" });
  await expect(dialog).toBeVisible();
  await noPageOverflow();
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(dialog).toBeHidden();
});
