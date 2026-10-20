import { runBenchmark } from "/benchmarks/benchmark.js";

const button = document.querySelector("#run");
const status = document.querySelector("#status");
const results = document.querySelector("#results");

async function run() {
  button.disabled = true;
  status.textContent = "Rust/WASMを読み込み、計測しています…";
  try {
    const result = await runBenchmark((message) => {
      status.textContent = message;
    });
    window.__REFRAME_BENCHMARK_RESULT__ = result;
    const rows = result.cases
      .map(
        (item) => `<tr>
          <td>${item.name}</td>
          <td>${formatMs(item.typescriptMs)}</td>
          <td>${formatMs(item.rustWasmMs)}</td>
          <td class="${item.ratio > 1 ? "faster" : "slower"}">${item.ratio.toFixed(2)}×</td>
          <td>${item.resultMatch ? "一致" : "不一致"}</td>
        </tr>`,
      )
      .join("");
    results.innerHTML = `<table>
      <thead><tr><th>処理</th><th>TypeScript</th><th>Rust/WASM</th><th>TS / Rust</th><th>出力</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p>1.00×より大きいほどRust/WASMが速い。初期化情報:</p>
    <pre>${JSON.stringify(result.startup, null, 2)}</pre>`;
    status.textContent = "計測完了";
  } catch (error) {
    status.textContent = `計測失敗: ${error instanceof Error ? error.message : String(error)}`;
    throw error;
  } finally {
    button.disabled = false;
  }
}

function formatMs(value) {
  if (value < 0.01) return `${(value * 1000).toFixed(2)} µs`;
  return `${value.toFixed(3)} ms`;
}

button.addEventListener("click", run);
if (new URLSearchParams(location.search).has("autorun")) run();
