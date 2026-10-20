import * as ort from 'onnxruntime-web/wasm';
import {
  batchTextFeatures, cosineDot, EMBEDDING_DIM, FEATURE_DIM,
  frozenEmbedding, lexicalScores, textFeatures,
} from './features';

export type RankingMethod = 'trained' | 'lexical' | 'embedding';
export interface RankCandidate { id: string; text: string }
export interface RankedCandidate { id: string; score: number }
export interface ModelStatus { ready: boolean; model: string; error?: string }
export interface InferenceMeasurement {
  method: RankingMethod;
  elapsedMs: number;
  candidateCount: number;
  backend: 'wasm' | 'javascript';
}

const MODEL_NAME = 'Reframe relevance encoder v1';
let modelSession: ort.InferenceSession | undefined;
let initializing: Promise<void> | undefined;
let status: ModelStatus = { ready: false, model: MODEL_NAME };
let lastInference: InferenceMeasurement | null = null;

/** Download and initialize the real exported PyTorch weights in ORT Web WASM. */
export async function initializeModel(): Promise<void> {
  if (modelSession) return;
  if (initializing) return initializing;
  initializing = (async () => {
    try {
      ort.env.wasm.wasmPaths = '/ort/';
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      modelSession = await ort.InferenceSession.create('/models/relevance.onnx', {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      status = { ready: true, model: MODEL_NAME };
    } catch (error) {
      status = {
        ready: false, model: MODEL_NAME,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    } finally {
      initializing = undefined;
    }
  })();
  return initializing;
}

export function getModelStatus(): ModelStatus {
  return { ...status };
}

export function getLastInference(): InferenceMeasurement | null {
  return lastInference ? { ...lastInference } : null;
}

/**
 * All methods process actual input. Scores are relative rankings, not confidence
 * probabilities and never decide applicability, impact, validity or approval.
 * A failed model load throws instead of silently substituting canned scores.
 */
export async function rankCandidates(
  query: string,
  candidates: RankCandidate[],
  method: RankingMethod = 'trained',
): Promise<RankedCandidate[]> {
  if (method !== 'trained' && method !== 'lexical' && method !== 'embedding') {
    throw new Error('Unknown ranking method');
  }
  if (candidates.length > 512) throw new Error('At most 512 candidates can be ranked in one request');
  if (query.length > 16000 || candidates.some((candidate) => candidate.text.length > 16000)) {
    throw new Error('Text must be 16,000 characters or fewer');
  }
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) {
    throw new Error('Candidate IDs must be unique');
  }
  if (method === 'trained' && candidates.length && query.trim()) await initializeModel();
  const start = performance.now();
  let ranWasm = false;
  let scores: number[];
  if (!query.trim()) {
    scores = candidates.map(() => 0);
  } else if (method === 'lexical') {
    scores = lexicalScores(query, candidates.map((candidate) => candidate.text));
  } else if (method === 'embedding') {
    const queryEmbedding = frozenEmbedding(textFeatures(query));
    scores = candidates.map((candidate) => cosineDot(queryEmbedding, frozenEmbedding(textFeatures(candidate.text))));
  } else if (!candidates.length) {
    scores = [];
  } else {
    const input = new ort.Tensor(
      'float32', batchTextFeatures([query, ...candidates.map((candidate) => candidate.text)]),
      [candidates.length + 1, FEATURE_DIM],
    );
    let output: ort.InferenceSession.ReturnType | undefined;
    try {
      output = await modelSession!.run({ features: input });
      ranWasm = true;
      const embeddings = output.embedding!.data as Float32Array;
      const queryEmbedding = embeddings.subarray(0, EMBEDDING_DIM);
      scores = candidates.map((_, index) => cosineDot(
        queryEmbedding, embeddings.subarray((index + 1) * EMBEDDING_DIM, (index + 2) * EMBEDDING_DIM),
      ));
    } finally {
      input.dispose();
      if (output) for (const tensor of Object.values(output)) tensor.dispose();
    }
  }
  const ranked = candidates.map((candidate, index) => ({ id: candidate.id, score: scores[index]! }))
    // ES2019 stable sort matches NumPy's stable original-order tie policy.
    .sort((a, b) => b.score - a.score);
  lastInference = {
    method, elapsedMs: performance.now() - start, candidateCount: candidates.length,
    backend: ranWasm ? 'wasm' : 'javascript',
  };
  return ranked;
}
