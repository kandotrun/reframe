# Frozen test failure analysis

This analysis reads the published per-query rankings after checkpoint selection.
It was not used to change the model, training data, hyperparameters, or test set.

The learned encoder placed a relevant document first on 28 of 48 questions.
BM25 did so on all 48 in this curated candidate set. That does not mean BM25 is
perfect at operational decisions: the labels measure broad topical relevance,
and some directly useful documents still fall outside its top five.

## Observed failures

| Held-out question | Learned top result | First relevant rank | What this illustrates |
| --- | --- | ---: | --- |
| 休止していた設備を動かします。最初だけ念入りに見る運用の根拠を探してください。 | A drawing document about surface flatness | 3 | The model does not reliably connect a restart situation with inspection sampling when the question omits familiar inspection terminology. |
| 温度の表示が別の計器と合いません。器具の精度を確かめる履歴を探したい。 | A document about storing paint away from sunlight | 9 | Temperature vocabulary draws the model toward storage instead of measurement calibration. |
| 運搬の振動で品物同士が接触する問題に関係する梱包資料を探してください。 | A document about road restrictions and delivery routes | 11 | Transport context overwhelms the distinction between packaging damage and delivery scheduling. |

These are descriptions of observed outputs, not an explanation derived from
model interpretability or a causal feature ablation.

The model ranks above the fixed random projection in aggregate, but that
projection is not the same architecture before training. The comparison cannot
isolate training as the only cause of the difference.

## Product consequence

BM25 remains the default retrieval method. The learned model is exposed as an
experiment with its actual weights, rankings and failures. Explicit dependency
links and deterministic applicability checks are never filtered by the model's
rank, and no similarity threshold grants approval.

The model's high similarity is not a probability. A low score is not grounds to
discard a required review. There is no tested no-answer threshold in this release.

## Next experiment, not a claim of completed work

An appropriate next experiment would compare a licensed pretrained Japanese
encoder with this model and BM25; add independently judged, multi-topic and
missing-answer cases; and reserve new scenario families before tuning. More
epochs on the current tiny corpus would not by itself establish generalization.
Any follow-up work must keep this v1 result visible rather than replacing it with
a score chosen after looking at the frozen test.
