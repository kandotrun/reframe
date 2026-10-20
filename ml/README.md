# Reproducible relevance training

This is a small, **from-scratch PyTorch text encoder**, not an LLM API wrapper.
The browser runs the exported weights using ONNX Runtime Web's CPU WASM backend.
It ranks Japanese candidate text for a change query. It does not decide whether
a revision applies, approve a change, or generate an operational instruction.

## Reproduce

Use Python 3.12 and run from the repository root:

```bash
uv venv --python 3.12 .venv
uv pip sync --python .venv/bin/python ml/requirements.lock.txt
.venv/bin/python ml/train.py
.venv/bin/python -m unittest discover -s tests -p 'ml*_test.py' -v
npm test -- tests/ml-features.test.ts
```

The training run is deterministic on the recorded CPU environment. Numerical
rounding and latency can vary across operating systems, processor architectures,
BLAS libraries and dependency releases. The lock records the exact package
versions used for the published run; it is not a universal binary-environment lock.

Training does not download a model or call an external service. Installing Python
and JavaScript dependencies requires network access. First browser initialization
downloads the ONNX weights and ORT runtime from the same origin as the application.

## What is trained

`features.py` normalizes NFKC/lowercase and hashes character 1–3 grams into a
2,048-dimensional vector. The network is `Linear(2048,128) → tanh →
Linear(128,64) → L2 normalization`. Shared query and document embeddings are
compared by dot product. The 270,336 learned parameters are optimized by AdamW
using a listwise relevance loss.

Only text enters the encoder. IDs, split names, topic names, labels and candidate
positions are metadata, not features. Labels are authored as topic relevance;
they do not encode the app's applicability, dependency or approval rules.

The generator contains separate training, development and test scenario families.
Every paraphrase in a scenario stays in its split. The checkpoint is selected
using development nDCG@5. The test set is evaluated only after checkpoint selection.
The corpus is synthetic and shares a topic taxonomy across splits; even perfect
scores would not demonstrate general-purpose Japanese retrieval or production
accuracy. See [the dataset card](DATASET.md).

## Comparisons

All methods rank exactly the same candidate set:

| Method | What it actually does |
| --- | --- |
| `lexical` | BM25 over character 1–3 grams, fitted to the query's candidate set |
| `embedding` | Fixed, untrained 64-dimensional random projection of hashed features |
| `trained` | The actual trained PyTorch encoder exported to ONNX |

The random projection is a diagnostic untrained baseline, **not a pretrained
semantic embedding model**. No comparison with a modern pretrained Japanese
retriever or commercial embedding service is claimed. BM25 is the lexical
baseline to beat; the report preserves results even when it wins.

MRR and top-1 use any positive relevance (`1` or `2`). nDCG@5 distinguishes direct
relevance (`2`) from useful background (`1`) using gain `2^relevance − 1`.
Recall@5 counts all positive documents. Since each evaluation query has at least
one positive, these measurements do not test no-answer rejection.

## Inspect the evidence

- [`artifacts/config.json`](artifacts/config.json): hyperparameters and selection policy.
- [`artifacts/dataset.json`](artifacts/dataset.json): every query, candidate, label and authored rationale.
- [`artifacts/split-manifest.json`](artifacts/split-manifest.json): IDs, families and query hashes.
- [`artifacts/split-audit.json`](artifacts/split-audit.json): exact duplicates and character n-gram proximity.
- [`artifacts/training-log.json`](artifacts/training-log.json): actual epoch losses and development scores.
- [`artifacts/relevance.pt`](artifacts/relevance.pt): selected `state_dict`, configuration and epoch.
- [`../public/models/relevance.onnx`](../public/models/relevance.onnx): deployed weights.
- [`../public/models/parity-fixtures.json`](../public/models/parity-fixtures.json): Python preprocessing and encoder outputs for cross-runtime checks.
- [`../public/evaluation/metrics.json`](../public/evaluation/metrics.json): computed frozen-test summary, family bootstrap intervals and timing scope.
- [`../public/evaluation/per-query.json`](../public/evaluation/per-query.json): all three complete rankings.
- [`../public/evaluation/errors.json`](../public/evaluation/errors.json): every trained result below perfect nDCG@5.

The Python timer includes feature extraction, encoding all candidates, and scoring
on a warm CPU session. It excludes model download and is **not browser latency**.
The product measures the actual browser call separately. Similarity scores are not
probabilities and are not calibrated confidence estimates.

## Current limits and next evaluation

This release intentionally makes a narrow, inspectable claim: a real train/export/
evaluate/deploy pipeline can rank a self-authored fictional corpus in the browser.
The next serious validation would use independently labeled cases, a stronger
pretrained baseline, unseen topics, multi-topic questions, missing-answer cases,
and revision/scope hard negatives. Those are not implied by this release.

The public synthetic corpus and weights contain no customer or private documents.
Application demo scenarios are not part of the frozen evaluation dataset.
