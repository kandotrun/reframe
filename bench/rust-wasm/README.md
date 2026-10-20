# Rust/WASM core benchmark

This is a measurement harness, not a production dependency. It compares the
same algorithms in TypeScript/JavaScript and Rust compiled to WebAssembly:

1. generation-stamped graph propagation;
2. pre-indexed character n-gram BM25 scoring;
3. UTF-16 prefix/suffix change detection.

The harness runs in Chromium and includes every WASM call boundary. It excludes
React rendering, network time and the ONNX ranker.

```bash
npm run benchmark:rust
```

The command compiles the Rust crate, builds the web application, launches the
built benchmark route in headless Chromium, and writes `results.json`.

The benchmark uses synthetic data, so its absolute timings are not a production
capacity claim. Small-data cases deliberately show whether WASM startup and
calling costs outweigh native JavaScript for Reframe's current data size.
