"""Portable, deterministic text features shared with src/ml/features.ts.

Only the supplied free text is encoded. Case IDs, labels, metadata, document
versions and candidate order never enter the feature vector.
"""
from __future__ import annotations

from collections import Counter
import math
import unicodedata

import numpy as np

FEATURE_DIM = 2048
EMBEDDING_DIM = 64
FEATURE_VERSION = "nfkc-fnv1a-codepoint-char123-v1"
REMOVED = frozenset(" \t\n\r。、，．！？!?「」『』（）()[]【】〈〉《》：:；;・／/\\\"'`")


def normalize(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKC", text).lower() if c not in REMOVED)


def fnv1a(text: str) -> int:
    value = 2166136261
    for char in text:
        value = ((value ^ ord(char)) * 16777619) & 0xFFFFFFFF
    return value


def terms(text: str) -> list[str]:
    normalized = normalize(text)
    return [
        normalized[i:i + n]
        for n in (1, 2, 3)
        for i in range(max(0, len(normalized) - n + 1))
    ]


def features(text: str) -> np.ndarray:
    out = np.zeros(FEATURE_DIM, dtype=np.float32)
    normalized = normalize(text)
    for n, weight in ((1, 0.35), (2, 1.0), (3, 0.7)):
        for i in range(max(0, len(normalized) - n + 1)):
            out[fnv1a(normalized[i:i + n]) % FEATURE_DIM] += weight
    norm = float(np.linalg.norm(out))
    if norm:
        out /= norm
    return out


def batch_features(texts: list[str]) -> np.ndarray:
    return np.stack([features(text) for text in texts])


def random_projection_matrix() -> np.ndarray:
    """A fixed Rademacher projection, NOT a pretrained semantic model."""
    matrix = np.empty((FEATURE_DIM, EMBEDDING_DIM), dtype=np.float32)
    scale = 1.0 / math.sqrt(EMBEDDING_DIM)
    for row in range(FEATURE_DIM):
        for col in range(EMBEDDING_DIM):
            mixed = ((row + 1) * 2654435761 ^ (col + 1) * 2246822519) & 0xFFFFFFFF
            mixed ^= mixed >> 16
            mixed = (mixed * 3266489917) & 0xFFFFFFFF
            mixed ^= mixed >> 13
            matrix[row, col] = scale if mixed & 1 else -scale
    return matrix


def project(matrix: np.ndarray, projection: np.ndarray) -> np.ndarray:
    output = matrix @ projection
    return output / np.maximum(np.linalg.norm(output, axis=-1, keepdims=True), 1e-8)


def bm25(query: str, documents: list[str]) -> np.ndarray:
    """Character 1–3 gram BM25, k1=1.2/b=0.75, fitted to candidates."""
    query_terms = set(terms(query))
    counters = [Counter(terms(doc)) for doc in documents]
    lengths = [sum(counter.values()) for counter in counters]
    average_length = sum(lengths) / max(1, len(lengths))
    scores = np.zeros(len(documents), dtype=np.float32)
    if not query_terms or not average_length:
        return scores
    for term in query_terms:
        frequency = sum(term in counter for counter in counters)
        inverse = math.log(1 + (len(documents) - frequency + 0.5) / (frequency + 0.5))
        for i, counter in enumerate(counters):
            count = counter.get(term, 0)
            denominator = count + 1.2 * (1 - 0.75 + 0.75 * lengths[i] / average_length)
            if denominator:
                scores[i] += inverse * count * 2.2 / denominator
    return scores
