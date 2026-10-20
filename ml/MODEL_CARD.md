# Reframe relevance encoder v1

**Status: experimental. The lexical baseline wins this evaluation.**

The purpose of this model is to make the train → evaluate → export → browser
inference path inspectable. This release does not claim to outperform BM25 or a
pretrained Japanese retriever.

## Model

- From-scratch PyTorch encoder, 270,336 trained parameters.
- Hashed Japanese character n-grams (2,048 features), 128 hidden units, 64 output dimensions.
- Shared query/document encoder; normalized vectors are scored by cosine dot product.
- No pretrained weights, external AI service, private data or customer documents.
- Deployed ONNX weights: 1,082,190 bytes.
- Model SHA-256: `0b31a3296fbb37adfc8c803db9361cf0f8660ca98d71e6cc61bafe63cb72b0eb`.
- Intended use: ordering related fictional documents for a person's inspection.
- Out of scope: correctness, revision applicability, causal impact, approval,
  safety, calibrated confidence, or automatic operational decisions.

## Training

The self-authored corpus contains 160 training queries in 16 scenario families,
32 development queries in another 16 families, and 48 test queries in another
16 families. Each query has 18 candidates and three relevant documents.
Train/dev/test documents and exact query strings are disjoint; the same 16 broad
themes appear in every split. See [DATASET.md](DATASET.md) for label construction
and the important dependence between paraphrases.

Seed 29, AdamW, learning rate 0.002, weight decay 0.0001, batch size 16,
temperature 0.09, 100 epochs. The target distribution is proportional to
`2^relevance - 1`. The highest development nDCG@5 selected epoch 50.
Test labels were not used for optimization or checkpoint selection.

## Frozen test result

| Method | MRR | nDCG@5 | Recall@5 | Relevant top-1 |
| --- | ---: | ---: | ---: | ---: |
| Character n-gram BM25 | 1.0000 | **0.8752** | **0.8750** | **1.0000** |
| Fixed untrained random projection | 0.6131 | 0.3986 | 0.4236 | 0.4792 |
| Trained encoder | 0.7159 | 0.6084 | 0.6667 | 0.5833 |

The trained model ranks better than the fixed random projection on this set, but
the projection has a different architecture, so this is not a controlled
same-architecture training ablation. The lexical result is substantially better.
This is evidence to keep BM25 as the practical default while exposing the
experimental learned ranking for comparison.

The 95% family-bootstrap interval for nDCG@5 is `[0.5015, 0.7149]` for the trained
model and `[0.8403, 0.9049]` for BM25. These are uncertainty summaries for 16
authored test families, not confidence about real organizations or new topics.

Observed warm CPU median time was 1.204 ms for the trained method and 0.652 ms
for BM25 on the recorded Darwin arm64 run. Timings include feature extraction,
all 18 candidate encodings and scoring, but exclude loading and network. They
are not browser or end-to-end application timings.

The maximum absolute PyTorch → ONNX Runtime output difference on the exported
parity fixture was `8.94e-8`, below the `1e-5` tolerance. JavaScript preprocessing
also has checked fixtures. Browser execution must be tested separately from this
Python export check.

## Known limits

The corpus is synthetic and model-assisted, with one author and shared topic
vocabulary. Labels are assigned at topic level and are not an independent
judgment of whether a document answers every sub-question. All queries have
relevant candidates. The model has not been validated on uncontrolled documents,
new topics, missing-answer queries or detailed version/scope interpretation.

The network can compress recurring character patterns into useful similarities,
but has no broad pretrained language knowledge. With only 160 queries and 48
training documents, a substantial gap between training fit and held-out
scenario performance is unsurprising. This explanation is a hypothesis, not an
experimentally isolated cause.

The application keeps explicit source links, effective dates, product scope and
review decisions outside the ranker. A high similarity score cannot make an
inapplicable clause applicable. A low score cannot remove an explicit dependency.

## Reproduce and inspect

See [README.md](README.md) for commands, the exact dependency lock, checkpoint,
training curve, all per-query rankings and failure cases. The frozen results are
stored in [`public/evaluation/metrics.json`](../public/evaluation/metrics.json).
Any future model iteration should use development results and a new untouched
evaluation set before making a new generalization claim.
