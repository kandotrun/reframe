# Fictional change-retrieval corpus

This dataset is original, self-authored Japanese demonstration material. It uses
no customer records, uploaded documents, company repositories, or external
training corpus. All situations, documents, queries, and labels were created for
this project. They do not describe actual organizations or establish valid
industrial procedures.

The original corpus is distributed under the repository's MIT license. No
third-party corpus or pretrained model is included.

## What it measures

The task is **topical retrieval among a supplied candidate set**: which documents
help investigate a particular operational question? Sixteen themes cover
inspection sampling, material certificates, packaging moisture, delivery
schedules, dimensional tolerances, calibration, supplier changes, traceability,
surface finish, storage temperature, billing, knowledge handoff, controlled
access, record retention, shipping damage, and substitute inventory.

The labels are:

- `2`: a document directly discussing the question's operational subject.
- `1`: supporting records or context for that same operational subject.
- `0`: another subject, including deliberately nearby concepts.

These labels **do not measure correctness of an instruction, current revision
validity, contractual applicability, safety, causal impact, or approval**. A
document describing an old rule can be relevant evidence. The application must
check versions and explicit links separately. Similar language does not prove
that one case depends on another.

## Size and split

| Split | Scenario families | Queries | Distinct documents | Query-document pairs |
| --- | ---: | ---: | ---: | ---: |
| Train | 16 | 160 | 48 | 2,880 |
| Development | 16 | 32 | 48 | 576 |
| Test | 16 | 48 | 48 | 864 |
| Total | 48 | 240 | 144 | 4,320 |

Every query has 18 candidates: two direct positives, one supporting positive,
nine negatives from three related themes, and six negatives from other themes.
Positive and negative document positions are deterministically shuffled with
SHA-256-derived per-query seeds. A document never receives two positions within
one query. All queries have a relevant answer, so MRR is defined for every query.
The corpus does **not** evaluate no-answer detection or abstention.

A family is a complete authored scenario: for example, rechecking sampling when
a machine restarts after a shutdown. All query paraphrases for that scenario
belong to one split. Each split has a separate document pool and independently
written scenarios; no sentence template was copied between splits by merely
changing names, dates, or quantities. Queries within a family intentionally
overlap and refer to the same three positive documents.

The same broad themes occur in all splits. Training might discuss a caliper's
calibration expiry, development a repaired pressure gauge, and test an inaccurate
temperature logger. This is **within-domain generalization to authored scenario
families**, not transfer to unseen industries or new topic classes.

## Reproducibility and leakage controls

`corpus.py` contains the entire source corpus. `build_dataset()` returns plain
Python records with `id`, `family`, `split`, `query`, `candidates`, and `scenario`.
Candidate records contain `id`, `text`, `relevance`, and `reason`.

Only the query string and candidate `text` may enter the encoder or baseline.
IDs, family, scenario descriptions, split, label, label explanation, position,
and topic keys are metadata, never features. Token vocabulary and learned
statistics must be fitted on training text alone. Hyperparameter choices use
development results. Freeze choices before running the reported test evaluation.

Exact duplicate query or document strings across splits should be checked.
Character-shingle near-duplicate comparisons should also be reported: distinct
wording does not remove shared domain vocabulary or the author's consistent
style. The final report should state the measured overlap, rather than asserting
that a grouped split removes all dependence.

The initial corpus audit found zero exact query/document duplicates between
splits. The maximum raw character 5-gram Jaccard similarity was:

| Split pair | Query maximum | Document maximum |
| --- | ---: | ---: |
| Train / development | 0.1364 | 0.0577 |
| Train / test | 0.1429 | 0.0522 |
| Development / test | 0.1429 | 0.0686 |

This lexical check is not a semantic independence test. Positive candidates
occurred at all 18 positions, with 30–47 positive occurrences per position over
the 240 examples. These are corpus integrity measurements, not model results.

The broad topical labels are assigned consistently at theme level, rather than
independently annotating each pair against detailed sub-intents. This can reward
topic recognition even if a retrieved document does not completely answer every
detail in a query. Candidate sets are curated and contain 3 positives in 18
documents; their metrics are not directly comparable with retrieval against a
large uncontrolled document collection.

## Limitations and appropriate claims

This is a **synthetic, single-author, model-assisted benchmark**. Query wording,
documents, and relevance judgments share a construction process. Multiple
queries in a family are correlated, and every split covers the same 16 themes.
Good results demonstrate that the included training and inference pipeline works
on these fixtures. They do not establish industrial accuracy, customer benefit,
independent human evaluation, safety, or superiority over production systems.

For a real deployment, obtain appropriately licensed and consented examples,
have separate reviewers label relevance, resolve disagreements, hold out whole
organizations/projects and future document versions, and test no-answer cases.
Report failures and uncertainty. Do not silently tune on this test set after
seeing its outcome; any later adjustment requires a new held-out evaluation.
