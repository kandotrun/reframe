#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="$repo_root/bench/rust-wasm/Cargo.toml"
output="$repo_root/public/benchmarks/rust"
cargo_target="$repo_root/bench/rust-wasm/target"

rustup target add wasm32-unknown-unknown
cargo build \
  --manifest-path "$manifest" \
  --release \
  --target wasm32-unknown-unknown \
  --target-dir "$cargo_target"

mkdir -p "$output"
rm -f "$output/rust_bench.js" "$output/rust_bench_bg.wasm" "$output/rust_bench.d.ts"
wasm-bindgen \
  "$cargo_target/wasm32-unknown-unknown/release/reframe_rust_bench.wasm" \
  --out-dir "$output" \
  --target web \
  --out-name rust_bench \
  --no-typescript

printf 'Rust/WASM benchmark module written to %s\n' "$output"
