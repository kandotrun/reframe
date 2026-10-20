const removed = new Set(Array.from(" \t\n\r。、，．！？!?「」『』（）()[]【】〈〉《》：:；;・／/\\\"'`"));

function normalizeText(text) {
  return Array.from(text.normalize("NFKC").toLowerCase()).filter((character) => !removed.has(character));
}

function textTerms(text) {
  const normalized = normalizeText(text);
  const output = [];
  for (const size of [1, 2, 3]) {
    for (let index = 0; index <= normalized.length - size; index++) {
      output.push(normalized.slice(index, index + size).join(""));
    }
  }
  return output;
}

class JavaScriptImpactEngine {
  constructor(offsets, edges) {
    this.offsets = offsets;
    this.edges = edges;
    this.marks = new Uint32Array(offsets.length - 1);
    this.queue = new Uint32Array(offsets.length);
    this.generation = 0;
  }

  propagate(seeds) {
    this.generation++;
    if (this.generation === 0xffffffff) {
      this.marks.fill(0);
      this.generation = 1;
    }
    let tail = 0;
    for (const seed of seeds) {
      if (seed < this.marks.length && this.marks[seed] !== this.generation) {
        this.marks[seed] = this.generation;
        this.queue[tail++] = seed;
      }
    }
    let cursor = 0;
    while (cursor < tail) {
      const node = this.queue[cursor++];
      for (let edge = this.offsets[node]; edge < this.offsets[node + 1]; edge++) {
        const next = this.edges[edge];
        if (this.marks[next] !== this.generation) {
          this.marks[next] = this.generation;
          this.queue[tail++] = next;
        }
      }
    }
    return tail;
  }
}

class JavaScriptSearchEngine {
  constructor(documents) {
    this.documents = documents.map((document) => {
      const counts = new Map();
      let length = 0;
      for (const term of textTerms(document)) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
        length++;
      }
      return { counts, length };
    });
  }

  score(query) {
    const queryTerms = new Set(textTerms(query));
    const averageLength = this.documents.reduce((sum, document) => sum + document.length, 0) / Math.max(1, this.documents.length);
    if (!averageLength) return 0;
    const scores = new Float64Array(this.documents.length);
    for (const term of queryTerms) {
      const frequency = this.documents.filter((document) => document.counts.has(term)).length;
      const inverse = Math.log(1 + (this.documents.length - frequency + 0.5) / (frequency + 0.5));
      this.documents.forEach((document, index) => {
        const count = document.counts.get(term) ?? 0;
        const denominator = count + 1.2 * (1 - 0.75 + 0.75 * document.length / averageLength);
        if (denominator) scores[index] += inverse * count * 2.2 / denominator;
      });
    }
    return scores.reduce((sum, score) => sum + score, 0);
  }
}

function javascriptDiffChangedLength(before, after) {
  let start = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  let end = 0;
  while (end < Math.min(before.length, after.length) - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return after.length - start - end;
}

function xorshift32(state) {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

function makeGraph(nodeCount, degree) {
  const offsets = new Uint32Array(nodeCount + 1);
  const edges = new Uint32Array(nodeCount * degree);
  let state = 0x9e3779b9;
  let edge = 0;
  for (let node = 0; node < nodeCount; node++) {
    offsets[node] = edge;
    for (let item = 0; item < degree; item++) {
      state = xorshift32(state + node * 17 + item);
      edges[edge++] = state % nodeCount;
    }
  }
  offsets[nodeCount] = edge;
  return { offsets, edges };
}

function makeDocuments(count, seed) {
  const vocabulary = [
    "検査", "仕様", "改訂", "部品", "証拠", "数量", "工程", "材料", "品質", "納期",
    "手順", "担当", "記録", "校正", "包装", "湿度", "調達", "出荷", "条件", "適用",
    "ロット", "測定器", "承認", "確認", "作業", "引継", "期限", "変更", "顧客", "製品",
  ];
  let state = seed;
  const documents = [];
  for (let document = 0; document < count; document++) {
    const parts = [];
    for (let word = 0; word < 34; word++) {
      state = xorshift32(state + document * 31 + word);
      parts.push(vocabulary[state % vocabulary.length]);
    }
    documents.push(parts.join("、") + "。");
  }
  return documents;
}

function makeText(length) {
  const phrase = "仕様改訂後の検査条件と材料記録を確認し、担当者へ根拠と未解決事項を引き継ぐ。";
  return phrase.repeat(Math.ceil(length / phrase.length)).slice(0, length);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function p95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function measure(operation, repeats, sampleCount = 11) {
  for (let index = 0; index < 3; index++) operation();
  const samples = [];
  let result;
  for (let sample = 0; sample < sampleCount; sample++) {
    const start = performance.now();
    for (let repeat = 0; repeat < repeats; repeat++) result = operation();
    samples.push((performance.now() - start) / repeats);
  }
  return { medianMs: median(samples), p95Ms: p95(samples), result };
}

function caseResult(name, typescript, rustWasm, resultMatch) {
  return {
    name,
    typescriptMs: typescript.medianMs,
    typescriptP95Ms: typescript.p95Ms,
    rustWasmMs: rustWasm.medianMs,
    rustWasmP95Ms: rustWasm.p95Ms,
    ratio: typescript.medianMs / rustWasm.medianMs,
    resultMatch,
  };
}

export async function runBenchmark(progress = () => {}) {
  progress("Rust/WASMを読み込み中…");
  const moduleStart = performance.now();
  const { default: initialize, ImpactEngine, SearchEngine, diff_changed_len: rustDiff } = await import("/benchmarks/rust/rust_bench.js");
  await initialize();
  const moduleLoadMs = performance.now() - moduleStart;

  const graphSmall = makeGraph(9, 4);
  const graphSmallSeeds = new Uint32Array([0]);
  const jsImpactBuildStart = performance.now();
  const jsImpactSmall = new JavaScriptImpactEngine(graphSmall.offsets, graphSmall.edges);
  const jsImpactSmallBuildMs = performance.now() - jsImpactBuildStart;
  const rustImpactBuildStart = performance.now();
  const rustImpactSmall = new ImpactEngine(graphSmall.offsets, graphSmall.edges);
  const rustImpactSmallBuildMs = performance.now() - rustImpactBuildStart;

  progress("現在規模の影響グラフと検索を計測中…");
  const impactSmallTs = measure(() => jsImpactSmall.propagate(graphSmallSeeds), 100_000);
  const impactSmallRust = measure(() => rustImpactSmall.propagate(graphSmallSeeds), 100_000);

  const documentsSmall = makeDocuments(5, 29);
  const querySmall = "校正記録 測定器 有効期限 ロット 検査";
  const jsSearchBuildStart = performance.now();
  const jsSearchSmall = new JavaScriptSearchEngine(documentsSmall);
  const jsSearchSmallBuildMs = performance.now() - jsSearchBuildStart;
  const rustSearchBuildStart = performance.now();
  const rustSearchSmall = new SearchEngine(documentsSmall);
  const rustSearchSmallBuildMs = performance.now() - rustSearchBuildStart;
  const searchSmallTs = measure(() => jsSearchSmall.score(querySmall), 20_000);
  const searchSmallRust = measure(() => rustSearchSmall.score(querySmall), 20_000);

  const beforeSmall = makeText(88);
  const afterSmall = beforeSmall.slice(0, 31) + "新しい検査記録を追加する" + beforeSmall.slice(44);
  const diffSmallTs = measure(() => javascriptDiffChangedLength(beforeSmall, afterSmall), 100_000);
  const diffSmallRust = measure(() => rustDiff(beforeSmall, afterSmall), 100_000);

  progress("大規模な影響グラフを構築中…");
  const graphLarge = makeGraph(50_000, 4);
  const graphLargeSeeds = new Uint32Array(500);
  for (let index = 0; index < graphLargeSeeds.length; index++) graphLargeSeeds[index] = index * 97 % 50_000;
  const jsLargeBuildStart = performance.now();
  const jsImpactLarge = new JavaScriptImpactEngine(graphLarge.offsets, graphLarge.edges);
  const jsImpactLargeBuildMs = performance.now() - jsLargeBuildStart;
  const rustLargeBuildStart = performance.now();
  const rustImpactLarge = new ImpactEngine(graphLarge.offsets, graphLarge.edges);
  const rustImpactLargeBuildMs = performance.now() - rustLargeBuildStart;
  const impactLargeTs = measure(() => jsImpactLarge.propagate(graphLargeSeeds), 5);
  const impactLargeRust = measure(() => rustImpactLarge.propagate(graphLargeSeeds), 5);

  progress("大規模な検索索引を構築中…");
  const documentsLarge = makeDocuments(5_000, 104729);
  const queryLarge = "包装の湿度条件と材料証明を確認";
  const jsLargeSearchBuildStart = performance.now();
  const jsSearchLarge = new JavaScriptSearchEngine(documentsLarge);
  const jsSearchLargeBuildMs = performance.now() - jsLargeSearchBuildStart;
  const rustLargeSearchBuildStart = performance.now();
  const rustSearchLarge = new SearchEngine(documentsLarge);
  const rustSearchLargeBuildMs = performance.now() - rustLargeSearchBuildStart;
  const searchLargeTs = measure(() => jsSearchLarge.score(queryLarge), 2, 7);
  const searchLargeRust = measure(() => rustSearchLarge.score(queryLarge), 2, 7);

  const beforeLarge = makeText(100_000);
  const afterLarge = beforeLarge.slice(0, 49_000) + "条件を全面改訂" + beforeLarge.slice(50_000);
  const diffLargeTs = measure(() => javascriptDiffChangedLength(beforeLarge, afterLarge), 20, 7);
  const diffLargeRust = measure(() => rustDiff(beforeLarge, afterLarge), 20, 7);

  return {
    measuredAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    startup: {
      wasmLoadAndInstantiateMs: moduleLoadMs,
      smallImpactBuild: { typescriptMs: jsImpactSmallBuildMs, rustWasmMs: rustImpactSmallBuildMs },
      smallSearchBuild: { typescriptMs: jsSearchSmallBuildMs, rustWasmMs: rustSearchSmallBuildMs },
      largeImpactBuild: { typescriptMs: jsImpactLargeBuildMs, rustWasmMs: rustImpactLargeBuildMs },
      largeSearchBuild: { typescriptMs: jsSearchLargeBuildMs, rustWasmMs: rustSearchLargeBuildMs },
    },
    cases: [
      caseResult("影響伝播: 9ノード", impactSmallTs, impactSmallRust, impactSmallTs.result === impactSmallRust.result),
      caseResult("影響伝播: 50,000ノード", impactLargeTs, impactLargeRust, impactLargeTs.result === impactLargeRust.result),
      caseResult("検索: 5文書", searchSmallTs, searchSmallRust, Math.abs(searchSmallTs.result - searchSmallRust.result) < 1e-7),
      caseResult("検索: 5,000文書", searchLargeTs, searchLargeRust, Math.abs(searchLargeTs.result - searchLargeRust.result) < 1e-7),
      caseResult("差分: 88文字", diffSmallTs, diffSmallRust, diffSmallTs.result === diffSmallRust.result),
      caseResult("差分: 100,000文字", diffLargeTs, diffLargeRust, diffLargeTs.result === diffLargeRust.result),
    ],
    method: {
      unit: "milliseconds per operation",
      warmups: 3,
      samples: "7–11 medians; p95 recorded",
      includes: "WASM boundary and typed-array/string marshaling per operation",
      excludes: "Vite, network, React rendering, ONNX inference",
    },
  };
}
