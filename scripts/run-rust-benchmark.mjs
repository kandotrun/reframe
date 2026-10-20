import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const server = spawn(
  "./node_modules/.bin/vite",
  ["preview", "--host", "127.0.0.1", "--port", "5188"],
  { stdio: ["ignore", "pipe", "pipe"] },
);

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:5188/benchmarks/");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Preview server did not start");
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:5188/benchmarks/?autorun=1");
    await page.waitForFunction(() => window.__REFRAME_BENCHMARK_RESULT__, null, { timeout: 180_000 });
    const result = await page.evaluate(() => window.__REFRAME_BENCHMARK_RESULT__);
    const output = process.argv[2] ?? "bench/rust-wasm/results.json";
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Wrote ${output}`);
    for (const item of result.cases) {
      console.log(`${item.name}: TS ${item.typescriptMs.toFixed(6)} ms, Rust/WASM ${item.rustWasmMs.toFixed(6)} ms, TS/Rust ${item.ratio.toFixed(2)}x`);
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}
