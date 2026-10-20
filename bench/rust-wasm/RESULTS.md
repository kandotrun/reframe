# Rust/WASM measurement

Measured on 2026-10-20 in headless Chrome 141 on Apple Silicon macOS. Each
figure below is the median of three independent browser page runs. Every page
run selected its result from 7–11 samples after three warmups.

All timings include the JavaScript-to-WASM call boundary and input marshaling.
They exclude React rendering, network time and the ONNX relevance model. Both
implementations were checked to produce the same result before accepting each
case.

| Processing | TypeScript | Rust/WASM | TypeScript / Rust |
| --- | ---: | ---: | ---: |
| Impact propagation, 9 nodes | 0.000046 ms | 0.000054 ms | 0.86× |
| Impact propagation, 50,000 nodes | 0.640 ms | 0.500 ms | 1.28× |
| Indexed search, 5 documents | 0.00710 ms | 0.00693 ms | 1.03× |
| Indexed search, 5,000 documents | 19.10 ms | 5.75 ms | 3.32× |
| Change detection, 88 UTF-16 units | 0.000164 ms | 0.000931 ms | 0.18× |
| Change detection, 100,000 UTF-16 units | 0.185 ms | 0.545 ms | 0.34× |

A value above `1.00×` means Rust/WASM was faster.

The generated WASM module is 157 KB. Browser load and instantiation took
12.5–14.5 ms in the three warm-cache runs. Building the 5,000-document index
was slightly slower in Rust: approximately 100.7 ms for TypeScript and 112.0 ms
for Rust/WASM.

## Interpretation

- At Reframe's current scale—three cases and five visible search
  candidates—Rust/WASM has no practical benefit. Small operations are already
  sub-millisecond, and the extra module initialization and boundary cost can
  make them slower.
- A preloaded 5,000-document index is a strong use case. Rust reduced a query
  from about 19.1 ms to 5.75 ms, a saving of roughly 13.4 ms per query, after
  paying the one-time index build cost.
- Graph propagation begins to win around tens of thousands of nodes. At the
  tested 50,000-node scale, it saved about 0.14 ms per traversal.
- Prefix/suffix change detection should remain in TypeScript. Copying strings
  across the WASM boundary and allocating UTF-16 buffers made Rust slower even
  for 100,000 units.

The correct next step is therefore conditional: move a search index to
Rust/WASM only when real content grows into thousands of documents or queries
are repeated frequently. Do not move short diffs, current case validation, or
the React state layer into Rust merely to add Rust to the stack.

Run the benchmark again with:

```bash
npm run benchmark:rust
```

The machine-readable single-run evidence is in [results.json](results.json).
The synthetic corpus's absolute throughput is not a production capacity claim.
