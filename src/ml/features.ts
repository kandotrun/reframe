/** Same feature contract as ml/features.py. Labels and IDs never enter this path. */
export const FEATURE_DIM = 2048;
export const EMBEDDING_DIM = 64;
export const FEATURE_VERSION = 'nfkc-fnv1a-codepoint-char123-v1';
const removed = new Set(Array.from(" \t\n\r。、，．！？!?「」『』（）()[]【】〈〉《》：:；;・／/\\\"'`"));

export function normalizeText(text: string): string[] {
  return Array.from(text.normalize('NFKC').toLowerCase()).filter((character) => !removed.has(character));
}

export function fnv1a(text: string): number {
  let value = 2166136261;
  for (const character of text) {
    value = Math.imul(value ^ character.codePointAt(0)!, 16777619) >>> 0;
  }
  return value;
}

export function textTerms(text: string): string[] {
  const normalized = normalizeText(text);
  const terms: string[] = [];
  for (const n of [1, 2, 3]) {
    for (let i = 0; i <= normalized.length - n; i++) {
      terms.push(normalized.slice(i, i + n).join(''));
    }
  }
  return terms;
}

export function textFeatures(text: string): Float32Array {
  const output = new Float32Array(FEATURE_DIM);
  const normalized = normalizeText(text);
  for (const [n, weight] of [[1, 0.35], [2, 1], [3, 0.7]] as const) {
    for (let i = 0; i <= normalized.length - n; i++) {
      output[fnv1a(normalized.slice(i, i + n).join('')) % FEATURE_DIM]! += weight;
    }
  }
  let norm = 0;
  for (const value of output) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm) for (let i = 0; i < output.length; i++) output[i]! /= norm;
  return output;
}

export function batchTextFeatures(texts: string[]): Float32Array {
  const output = new Float32Array(texts.length * FEATURE_DIM);
  texts.forEach((text, index) => output.set(textFeatures(text), index * FEATURE_DIM));
  return output;
}

let projection: Float32Array | undefined;

function getProjection(): Float32Array {
  if (projection) return projection;
  projection = new Float32Array(FEATURE_DIM * EMBEDDING_DIM);
  const scale = 1 / Math.sqrt(EMBEDDING_DIM);
  for (let row = 0; row < FEATURE_DIM; row++) {
    for (let col = 0; col < EMBEDDING_DIM; col++) {
      let mixed = (Math.imul(row + 1, 2654435761) ^ Math.imul(col + 1, 2246822519)) >>> 0;
      mixed ^= mixed >>> 16;
      mixed = Math.imul(mixed, 3266489917) >>> 0;
      mixed ^= mixed >>> 13;
      projection[row * EMBEDDING_DIM + col] = mixed & 1 ? scale : -scale;
    }
  }
  return projection;
}

/** A frozen, untrained random projection; intentionally NOT called pretrained. */
export function frozenEmbedding(features: Float32Array): Float32Array {
  const matrix = getProjection();
  const output = new Float32Array(EMBEDDING_DIM);
  for (let row = 0; row < FEATURE_DIM; row++) {
    if (!features[row]) continue;
    for (let col = 0; col < EMBEDDING_DIM; col++) {
      output[col]! += features[row]! * matrix[row * EMBEDDING_DIM + col]!;
    }
  }
  let norm = 0;
  for (const value of output) norm += value * value;
  norm = Math.max(Math.sqrt(norm), 1e-8);
  for (let i = 0; i < output.length; i++) output[i]! /= norm;
  return output;
}

export function cosineDot(left: Float32Array, right: Float32Array): number {
  let score = 0;
  for (let i = 0; i < left.length; i++) score += left[i]! * right[i]!;
  return score;
}

/** Character 1–3 gram BM25 over this candidate set: k1=1.2, b=0.75. */
export function lexicalScores(query: string, documents: string[]): number[] {
  const queryTerms = new Set(textTerms(query));
  const counts = documents.map((document) => {
    const counter = new Map<string, number>();
    for (const term of textTerms(document)) counter.set(term, (counter.get(term) ?? 0) + 1);
    return counter;
  });
  const lengths = counts.map((counter) => Array.from(counter.values()).reduce((a, b) => a + b, 0));
  const averageLength = lengths.reduce((a, b) => a + b, 0) / Math.max(1, documents.length);
  const scores = documents.map(() => 0);
  if (!averageLength) return scores;
  for (const term of queryTerms) {
    const frequency = counts.filter((counter) => counter.has(term)).length;
    const inverse = Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5));
    counts.forEach((counter, index) => {
      const count = counter.get(term) ?? 0;
      const denominator = count + 1.2 * (1 - 0.75 + 0.75 * lengths[index]! / averageLength);
      if (denominator) scores[index]! += inverse * count * 2.2 / denominator;
    });
  }
  return scores;
}
