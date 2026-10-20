"""Artifact integrity and scientific-contract checks. Run after ml/train.py."""
from pathlib import Path
import hashlib
import json
import sys
import unittest

import numpy as np
import onnxruntime as ort
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))
from corpus import build_dataset
from features import batch_features
from model import RelevanceEncoder
from train import audit_dataset, ranking_metrics


class PipelineContract(unittest.TestCase):
    def test_scenario_splits_and_no_exact_text_leakage(self):
        audit = audit_dataset(build_dataset())
        self.assertEqual(audit["overlappingFamilies"], 0)
        self.assertEqual(audit["exactNormalizedCrossSplitDuplicates"], 0)

    def test_export_matches_checkpoint_for_unseen_strings(self):
        checkpoint = torch.load(ROOT / "ml/artifacts/relevance.pt", map_location="cpu", weights_only=True)
        model = RelevanceEncoder()
        model.load_state_dict(checkpoint["state_dict"])
        model.eval()
        data = batch_features([
            "湿度が高いときに梱包材を再点検する必要はありますか",
            "材料ロットの証明と刻印が一致していない",
            "来週の会議室と昼食を予約したい",
            "", "🙂ＡＢＣ test",
        ])
        with torch.no_grad():
            expected = model(torch.from_numpy(data)).numpy()
        session = ort.InferenceSession(str(ROOT / "public/models/relevance.onnx"), providers=["CPUExecutionProvider"])
        actual = session.run(["embedding"], {"features": data})[0]
        np.testing.assert_allclose(expected, actual, atol=1e-5, rtol=1e-5)

    def test_artifacts_match_reported_identity_and_finite_training(self):
        metadata = json.loads((ROOT / "public/models/metadata.json").read_text())
        model = (ROOT / "public/models/relevance.onnx").read_bytes()
        self.assertEqual(metadata["sha256"], hashlib.sha256(model).hexdigest())
        self.assertEqual(metadata["onnxBytes"], len(model))
        logs = json.loads((ROOT / "ml/artifacts/training-log.json").read_text())
        self.assertGreater(len(logs), 1)
        self.assertTrue(all(np.isfinite(row["trainLoss"]) for row in logs))
        self.assertLess(logs[-1]["trainLoss"], logs[0]["trainLoss"])
        summary = json.loads((ROOT / "public/evaluation/metrics.json").read_text())
        best = max(logs, key=lambda row: row["devNdcgAt5"])
        self.assertEqual(summary["training"]["bestEpoch"], best["epoch"])
        records = build_dataset()
        for split in ("train", "dev", "test"):
            self.assertEqual(summary["data"][f"{split}Queries"], sum(r["split"] == split for r in records))

    def test_reported_metrics_can_be_recomputed_from_published_rankings(self):
        details = json.loads((ROOT / "public/evaluation/per-query.json").read_text())
        summary = json.loads((ROOT / "public/evaluation/metrics.json").read_text())
        for method in ("trained", "lexical", "embedding"):
            rows = [row for row in details if row["method"] == method]
            recomputed = [
                ranking_metrics(
                    [candidate["relevance"] for candidate in row["ranking"]],
                    np.asarray([candidate["score"] for candidate in row["ranking"]]),
                )
                for row in rows
            ]
            for metric in ("mrr", "ndcgAt5", "recallAt5", "top1"):
                self.assertAlmostEqual(np.mean([row[metric] for row in recomputed]), summary["metrics"][method][metric], places=5)

    def test_frozen_onnx_reproduces_heldout_metrics(self):
        """Independently execute the actual model, rather than trusting saved scores."""
        session = ort.InferenceSession(str(ROOT / "public/models/relevance.onnx"), providers=["CPUExecutionProvider"])
        rows = []
        for record in build_dataset():
            if record["split"] != "test":
                continue
            features = batch_features([record["query"], *[c["text"] for c in record["candidates"]]])
            embedding = session.run(["embedding"], {"features": features})[0]
            scores = embedding[1:] @ embedding[0]
            rows.append(ranking_metrics([c["relevance"] for c in record["candidates"]], scores))
        summary = json.loads((ROOT / "public/evaluation/metrics.json").read_text())
        for metric in ("mrr", "ndcgAt5", "recallAt5", "top1"):
            self.assertAlmostEqual(
                np.mean([row[metric] for row in rows]),
                summary["metrics"]["trained"][metric],
                places=5,
            )

    def test_features_do_not_contain_ids_or_labels(self):
        record = build_dataset()[0]
        data = batch_features([record["query"], record["candidates"][0]["text"]])
        record["id"] = "different-id"
        record["family"] = "different-family"
        record["candidates"][0]["id"] = "different-document"
        record["candidates"][0]["relevance"] = 0
        np.testing.assert_array_equal(data, batch_features([record["query"], record["candidates"][0]["text"]]))


if __name__ == "__main__":
    unittest.main()
