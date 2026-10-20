#!/usr/bin/env python3
"""Train on train, select on dev, then export and evaluate the frozen test set.

Run from the repository root: .venv/bin/python ml/train.py
All published numbers are computed here. No network or hosted AI service is used.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import random
import statistics
import time
from datetime import datetime, timezone

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch.nn import functional as F

from corpus import build_dataset
from features import (
    EMBEDDING_DIM, FEATURE_DIM, FEATURE_VERSION, batch_features,
    bm25, normalize, project, random_projection_matrix, terms,
)
from model import RelevanceEncoder

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "public/models"
EVAL_DIR = ROOT / "public/evaluation"
ARTIFACT_DIR = ROOT / "ml/artifacts"
SEED = 29


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def audit_dataset(records):
    families = {split: set() for split in ("train", "dev", "test")}
    texts = {split: set() for split in families}
    query_texts = {split: set() for split in families}
    ids = set()
    for record in records:
        assert record["id"] not in ids, "Duplicate query ID"
        ids.add(record["id"])
        split = record["split"]
        families[split].add(record["family"])
        assert any(candidate["relevance"] > 0 for candidate in record["candidates"])
        assert all(candidate["relevance"] in (0, 1, 2) for candidate in record["candidates"])
        assert len({candidate["id"] for candidate in record["candidates"]}) == len(record["candidates"])
        query_texts[split].add(normalize(record["query"]))
        texts[split].add(normalize(record["query"]))
        texts[split].update(normalize(candidate["text"]) for candidate in record["candidates"])
    pairs = (("train", "dev"), ("train", "test"), ("dev", "test"))
    for left, right in pairs:
        assert not families[left] & families[right], "Scenario family split leakage"
        assert not texts[left] & texts[right], "Exact normalized text split leakage"
    # The audit is descriptive; lexical proximity is not a proof of independence.
    near_duplicates = []
    max_jaccard = {}
    for left, right in pairs:
        left_grams = [(text, set(terms(text))) for text in texts[left]]
        right_grams = [(text, set(terms(text))) for text in texts[right]]
        maximum = 0.0
        for text_a, grams_a in left_grams:
            for text_b, grams_b in right_grams:
                similarity = len(grams_a & grams_b) / max(1, len(grams_a | grams_b))
                maximum = max(maximum, similarity)
                if similarity >= 0.65:
                    near_duplicates.append({
                        "splits": [left, right], "jaccard": round(similarity, 4),
                        "leftText": text_a, "rightText": text_b,
                    })
        max_jaccard[f"{left}:{right}"] = round(maximum, 4)
    return {
        "exactNormalizedCrossSplitDuplicates": 0,
        "overlappingFamilies": 0,
        "charNgramJaccardThreshold": 0.65,
        "maxCrossSplitJaccard": max_jaccard,
        "nearDuplicatePairs": near_duplicates,
        "note": "Separate authored scenarios and text templates; shared topic vocabulary remains. Single-author synthetic labels are not independent human validation.",
    }


def encode_records(records):
    document_map = {}
    for record in records:
        for candidate in record["candidates"]:
            if candidate["id"] in document_map:
                assert document_map[candidate["id"]] == candidate["text"]
            document_map[candidate["id"]] = candidate["text"]
    doc_ids = sorted(document_map)
    id_to_index = {document_id: i for i, document_id in enumerate(doc_ids)}
    documents = torch.from_numpy(batch_features([document_map[i] for i in doc_ids]))
    queries = torch.from_numpy(batch_features([record["query"] for record in records]))
    indices = torch.tensor([[id_to_index[c["id"]] for c in r["candidates"]] for r in records])
    relevance = torch.tensor([[c["relevance"] for c in r["candidates"]] for r in records], dtype=torch.float32)
    return queries, documents, indices, relevance


def ranking_metrics(relevance, scores):
    order = np.argsort(-scores, kind="stable")
    ranked = np.asarray(relevance)[order]
    positive_ranks = np.flatnonzero(ranked > 0)
    dcg = sum((2 ** value - 1) / math.log2(i + 2) for i, value in enumerate(ranked[:5]))
    ideal = sorted(relevance, reverse=True)[:5]
    ideal_dcg = sum((2 ** value - 1) / math.log2(i + 2) for i, value in enumerate(ideal))
    return {
        "mrr": 1.0 / (int(positive_ranks[0]) + 1) if len(positive_ranks) else 0,
        "ndcgAt5": dcg / ideal_dcg if ideal_dcg else 0,
        "recallAt5": float(sum(ranked[:5] > 0)) / max(1, sum(np.asarray(relevance) > 0)),
        "top1": float(ranked[0] > 0),
    }


@torch.no_grad()
def dev_score(model, encoded):
    queries, documents, indices, relevance = encoded
    document_vectors = model(documents)
    query_vectors = model(queries)
    scores = torch.sum(query_vectors[:, None, :] * document_vectors[indices], dim=-1).numpy()
    rows = [ranking_metrics(row.numpy(), score) for row, score in zip(relevance, scores)]
    return float(np.mean([row["ndcgAt5"] for row in rows]))


def evaluate(records, session):
    result = {}
    details = []
    projection = random_projection_matrix()
    sessions = lambda features: session.run(["embedding"], {"features": features})[0]
    # Warm-up is excluded; preprocessing, encoding and ranking are included below.
    sessions(batch_features(["検査記録", "材料証明書"]))
    for method in ("lexical", "embedding", "trained"):
        rows, durations = [], []
        for record in records:
            candidate_texts = [c["text"] for c in record["candidates"]]
            started = time.perf_counter()
            if method == "lexical":
                scores = bm25(record["query"], candidate_texts)
            else:
                features = batch_features([record["query"], *candidate_texts])
                embedded = sessions(features) if method == "trained" else project(features, projection)
                scores = embedded[1:] @ embedded[0]
            durations.append((time.perf_counter() - started) * 1000)
            relevance = [c["relevance"] for c in record["candidates"]]
            metrics = ranking_metrics(relevance, scores)
            rows.append(metrics)
            order = np.argsort(-scores, kind="stable")
            details.append({
                "id": record["id"], "family": record["family"], "method": method,
                "query": record["query"], **metrics,
                "ranking": [
                    {"id": record["candidates"][i]["id"], "text": candidate_texts[i],
                     "relevance": relevance[i], "reason": record["candidates"][i].get("reason", ""),
                     "score": round(float(scores[i]), 6)}
                    for i in order
                ],
            })
        result[method] = {
            key: round(float(np.mean([row[key] for row in rows])), 6)
            for key in ("mrr", "ndcgAt5", "recallAt5", "top1")
        } | {
            "medianMs": round(statistics.median(durations), 3),
            "p95Ms": round(float(np.percentile(durations, 95)), 3),
        }
    # Cluster bootstrap by held-out family, to avoid treating paraphrases as independent.
    rng = np.random.default_rng(SEED)
    families = sorted({r["family"] for r in records})
    confidence = {}
    for method in result:
        by_family = {
            family: [row for row in details if row["family"] == family and row["method"] == method]
            for family in families
        }
        scores = []
        for _ in range(1000):
            chosen = rng.choice(families, size=len(families), replace=True)
            scores.append(np.mean([row["ndcgAt5"] for family in chosen for row in by_family[family]]))
        confidence[method] = [round(float(n), 6) for n in np.percentile(scores, [2.5, 97.5])]
    return result, details, confidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=0.002)
    args = parser.parse_args()
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    random.seed(SEED)
    torch.use_deterministic_algorithms(True)
    for directory in (MODEL_DIR, EVAL_DIR, ARTIFACT_DIR):
        directory.mkdir(parents=True, exist_ok=True)
    records = build_dataset()
    audit = audit_dataset(records)
    save_json(ARTIFACT_DIR / "split-audit.json", audit)
    save_json(ARTIFACT_DIR / "dataset.json", records)
    save_json(ARTIFACT_DIR / "split-manifest.json", [
        {"id": r["id"], "family": r["family"], "split": r["split"],
         "querySha256": hashlib.sha256(r["query"].encode()).hexdigest(),
         "candidateIds": [c["id"] for c in r["candidates"]]}
        for r in records
    ])
    subsets = {split: [r for r in records if r["split"] == split] for split in ("train", "dev", "test")}
    encoded_train = encode_records(subsets["train"])
    encoded_dev = encode_records(subsets["dev"])
    config = {
        "seed": SEED, "epochs": args.epochs, "batchSize": args.batch_size,
        "learningRate": args.learning_rate, "weightDecay": 0.0001,
        "temperature": 0.09, "featureDim": FEATURE_DIM, "hiddenDim": 128,
        "embeddingDim": EMBEDDING_DIM, "featureVersion": FEATURE_VERSION,
        "loss": "listwise cross-entropy, target distribution proportional to 2^relevance - 1",
        "checkpointSelection": "highest dev nDCG@5; earlier epoch wins ties",
        "testPolicy": "evaluated only after final dev checkpoint selection",
    }
    save_json(ARTIFACT_DIR / "config.json", config)
    model = RelevanceEncoder()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.0001)
    queries, documents, indices, relevance = encoded_train
    best_score, best_epoch, best_state = -1.0, 0, None
    logs = []
    started = time.perf_counter()
    for epoch in range(1, args.epochs + 1):
        model.train()
        permutation = torch.randperm(len(queries))
        losses = []
        for offset in range(0, len(queries), args.batch_size):
            batch = permutation[offset:offset + args.batch_size]
            query_vectors = model(queries[batch])
            candidate_vectors = model(documents[indices[batch]])
            similarity = torch.sum(query_vectors[:, None, :] * candidate_vectors, dim=-1) / 0.09
            gain = 2 ** relevance[batch] - 1
            target = gain / gain.sum(dim=-1, keepdim=True)
            loss = -(target * F.log_softmax(similarity, dim=-1)).sum(dim=-1).mean()
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(loss.item())
        model.eval()
        score = dev_score(model, encoded_dev)
        row = {"epoch": epoch, "trainLoss": round(float(np.mean(losses)), 6), "devNdcgAt5": round(score, 6)}
        logs.append(row)
        if score > best_score + 1e-9:
            best_score, best_epoch = score, epoch
            best_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
        if epoch == 1 or epoch % 10 == 0:
            print(json.dumps(row), flush=True)
    duration = time.perf_counter() - started
    assert best_state is not None
    model.load_state_dict(best_state)
    model.eval()
    torch.save({"state_dict": best_state, "config": config, "bestEpoch": best_epoch}, ARTIFACT_DIR / "relevance.pt")
    save_json(ARTIFACT_DIR / "training-log.json", logs)
    # torchscript exporter is intentional: a tiny stable graph for ORT Web WASM.
    onnx_path = MODEL_DIR / "relevance.onnx"
    with torch.no_grad():
        torch.onnx.export(
            model, torch.zeros(2, FEATURE_DIM), str(onnx_path),
            input_names=["features"], output_names=["embedding"],
            dynamic_axes={"features": {0: "batch"}, "embedding": {0: "batch"}},
            opset_version=17, dynamo=False,
        )
    onnx.checker.check_model(onnx.load(str(onnx_path)))
    options = ort.SessionOptions()
    options.intra_op_num_threads = min(4, os.cpu_count() or 1)
    session = ort.InferenceSession(str(onnx_path), options, providers=["CPUExecutionProvider"])
    parity_texts = [
        "検査の抜取率を変更した。校正記録と全数測定の時間を調べる。",
        "材料証明書をロットごとに出荷前に照合する。",
        "包装内の湿度と乾燥剤の交換履歴を確認。",
        "空白　ＡＢＣ １２３\n日本語🙂",
        "",
    ]
    inputs = batch_features(parity_texts)
    with torch.no_grad():
        expected = model(torch.from_numpy(inputs)).numpy()
    actual = session.run(["embedding"], {"features": inputs})[0]
    max_error = float(np.max(np.abs(expected - actual)))
    assert max_error < 1e-5, f"Export parity error: {max_error}"
    save_json(MODEL_DIR / "parity-fixtures.json", {
        "texts": parity_texts, "features": [[{"index": int(i), "value": float(row[i])} for i in np.flatnonzero(row)] for row in inputs],
        "embeddings": expected.tolist(), "tolerance": 1e-5,
    })
    metrics, details, confidence = evaluate(subsets["test"], session)
    save_json(EVAL_DIR / "per-query.json", details)
    save_json(EVAL_DIR / "errors.json", [
        row for row in details if row["method"] == "trained" and row["ndcgAt5"] < 0.999999
    ])
    onnx_bytes = onnx_path.read_bytes()
    metadata = {
        "name": "Reframe relevance encoder v1",
        "architecture": "char n-gram hashing → Linear(2048,128) → tanh → Linear(128,64) → L2",
        "parameterCount": sum(parameter.numel() for parameter in model.parameters()),
        "onnxBytes": len(onnx_bytes),
        "sha256": hashlib.sha256(onnx_bytes).hexdigest(),
        "featureDim": FEATURE_DIM, "embeddingDim": EMBEDDING_DIM,
        "featureVersion": FEATURE_VERSION,
        "pretrained": False,
    }
    save_json(MODEL_DIR / "metadata.json", metadata)
    data = {
        "source": "Self-authored fictional Japanese operational changes. No private or customer data.",
        "splitDescription": "All splits cover the same 16 topics, but each has 16 separately authored scenario families with different queries and documents. Paraphrases stay together.",
        "splitDescriptionJa": "同じ16テーマの中で、各分割に別の16シナリオと文書を作成。言い換えはシナリオ単位で固定。実務データや未知テーマの評価ではありません。",
    }
    for split in subsets:
        data[f"{split}Queries"] = len(subsets[split])
        data[f"{split}Families"] = len({r["family"] for r in subsets[split]})
    summary = {
        "schemaVersion": 1, "model": metadata, "data": data,
        "metrics": metrics, "familyBootstrap95NdcgAt5": confidence,
        "training": {
            "epochs": args.epochs, "bestEpoch": best_epoch, "seed": SEED,
            "durationSeconds": round(duration, 3), "bestDevNdcgAt5": round(best_score, 6),
        },
        "parity": {"maxAbsoluteError": max_error, "tolerance": 1e-5},
        "measurement": {
            "runtime": f"Python {platform.python_version()}, PyTorch {torch.__version__}, ONNX Runtime {ort.__version__}",
            "platform": f"{platform.system()} {platform.machine()}",
            "timing": "CPU, warm session, per-query feature extraction + all candidate encoding + scoring; excludes network/model download; not browser latency",
            "candidateCount": len(subsets["test"][0]["candidates"]),
        },
        "limitations": [
            "Self-authored synthetic data, one author and a shared topic taxonomy; not independently annotated real-world evidence.",
            "Held-out scenario families and separately authored templates reduce direct leakage but do not establish out-of-domain generalization.",
            "A small encoder trained from scratch; no pretrained language knowledge. Random projection baseline is untrained, not a semantic embedding service.",
            "All evaluation queries have relevant candidates. No calibrated no-answer or automatic applicability claim is made.",
            "Relevance is distinct from validity, revision applicability, cause, safety, or approval. Those require explicit rules and human review.",
            "Scores are relative cosine similarities, not probabilities. CPU benchmark times are not browser end-to-end times.",
        ],
        "evaluatedAt": datetime.now(timezone.utc).isoformat(),
    }
    save_json(EVAL_DIR / "metrics.json", summary)
    save_json(EVAL_DIR / "training-curve.json", logs)
    save_json(EVAL_DIR / "split-audit.json", audit)
    print(json.dumps({"bestEpoch": best_epoch, "metrics": metrics, "parityMaxError": max_error, "modelBytes": len(onnx_bytes)}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
