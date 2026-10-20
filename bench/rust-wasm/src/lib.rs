use std::collections::{HashMap, HashSet};
use unicode_normalization::UnicodeNormalization;
use wasm_bindgen::prelude::*;

fn normalize(text: &str) -> Vec<char> {
    text.nfkc()
        .flat_map(char::to_lowercase)
        .filter(|character| {
            !character.is_whitespace()
                && !matches!(
                    character,
                    '。' | '、'
                        | '，'
                        | '．'
                        | '！'
                        | '？'
                        | '!'
                        | '?'
                        | '「'
                        | '」'
                        | '『'
                        | '』'
                        | '（'
                        | '）'
                        | '('
                        | ')'
                        | '['
                        | ']'
                        | '【'
                        | '】'
                        | '〈'
                        | '〉'
                        | '《'
                        | '》'
                        | '：'
                        | ':'
                        | '；'
                        | ';'
                        | '・'
                        | '／'
                        | '/'
                        | '\\'
                        | '"'
                        | '\''
                        | '`'
                )
        })
        .collect()
}

fn terms(text: &str) -> Vec<String> {
    let characters = normalize(text);
    let mut output = Vec::with_capacity(characters.len().saturating_mul(3));
    for size in 1..=3 {
        if characters.len() >= size {
            for window in characters.windows(size) {
                output.push(window.iter().collect());
            }
        }
    }
    output
}

#[wasm_bindgen]
pub struct ImpactEngine {
    offsets: Vec<u32>,
    edges: Vec<u32>,
    marks: Vec<u32>,
    queue: Vec<u32>,
    generation: u32,
}

#[wasm_bindgen]
impl ImpactEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(offsets: &[u32], edges: &[u32]) -> Self {
        Self {
            offsets: offsets.to_vec(),
            edges: edges.to_vec(),
            marks: vec![0; offsets.len().saturating_sub(1)],
            queue: Vec::new(),
            generation: 0,
        }
    }

    pub fn propagate(&mut self, seeds: &[u32]) -> u32 {
        self.generation = self.generation.wrapping_add(1);
        if self.generation == 0 {
            self.marks.fill(0);
            self.generation = 1;
        }
        self.queue.clear();
        for &seed in seeds {
            let index = seed as usize;
            if index < self.marks.len() && self.marks[index] != self.generation {
                self.marks[index] = self.generation;
                self.queue.push(seed);
            }
        }
        let mut cursor = 0;
        while cursor < self.queue.len() {
            let node = self.queue[cursor] as usize;
            cursor += 1;
            let start = self.offsets[node] as usize;
            let end = self.offsets[node + 1] as usize;
            for &next in &self.edges[start..end] {
                let next_index = next as usize;
                if self.marks[next_index] != self.generation {
                    self.marks[next_index] = self.generation;
                    self.queue.push(next);
                }
            }
        }
        self.queue.len() as u32
    }
}

#[wasm_bindgen]
pub struct SearchEngine {
    document_counts: Vec<HashMap<String, u32>>,
    lengths: Vec<f64>,
}

#[wasm_bindgen]
impl SearchEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(documents: Vec<String>) -> Self {
        let mut document_counts = Vec::with_capacity(documents.len());
        let mut lengths = Vec::with_capacity(documents.len());
        for document in documents {
            let mut counts = HashMap::new();
            let mut length = 0_u32;
            for term in terms(&document) {
                *counts.entry(term).or_insert(0) += 1;
                length += 1;
            }
            document_counts.push(counts);
            lengths.push(length as f64);
        }
        Self {
            document_counts,
            lengths,
        }
    }

    pub fn score(&self, query: &str) -> f64 {
        if self.document_counts.is_empty() {
            return 0.0;
        }
        let query_terms: HashSet<String> = terms(query).into_iter().collect();
        let document_count = self.document_counts.len();
        let average_length = self.lengths.iter().sum::<f64>() / document_count.max(1) as f64;
        if average_length == 0.0 {
            return 0.0;
        }
        let mut scores = vec![0.0; document_count];
        for term in query_terms {
            let frequency = self
                .document_counts
                .iter()
                .filter(|counts| counts.contains_key(&term))
                .count();
            let inverse = (1.0
                + (document_count as f64 - frequency as f64 + 0.5) / (frequency as f64 + 0.5))
                .ln();
            for (index, counts) in self.document_counts.iter().enumerate() {
                let count = *counts.get(&term).unwrap_or(&0) as f64;
                let denominator =
                    count + 1.2 * (1.0 - 0.75 + 0.75 * self.lengths[index] / average_length);
                if denominator != 0.0 {
                    scores[index] += inverse * count * 2.2 / denominator;
                }
            }
        }
        scores.into_iter().sum()
    }
}

#[wasm_bindgen]
pub fn diff_changed_len(before: &str, after: &str) -> u32 {
    let left: Vec<u16> = before.encode_utf16().collect();
    let right: Vec<u16> = after.encode_utf16().collect();
    let mut start = 0;
    while start < left.len().min(right.len()) && left[start] == right[start] {
        start += 1;
    }
    let mut end = 0;
    while end < left.len().min(right.len()).saturating_sub(start)
        && left[left.len() - 1 - end] == right[right.len() - 1 - end]
    {
        end += 1;
    }
    (right.len().saturating_sub(start + end)) as u32
}

#[cfg(test)]
mod tests {
    use super::{ImpactEngine, SearchEngine, diff_changed_len};

    #[test]
    fn propagation_is_deterministic_and_generation_safe() {
        let offsets = [0, 2, 3, 3, 3];
        let edges = [1, 2, 2];
        let mut engine = ImpactEngine::new(&offsets, &edges);
        assert_eq!(engine.propagate(&[0]), 3);
        assert_eq!(engine.propagate(&[3]), 1);
        assert_eq!(engine.propagate(&[0, 0]), 3);
    }

    #[test]
    fn lexical_scores_are_finite_and_sensitive_to_the_query() {
        let engine = SearchEngine::new(vec![
            "材料証明書とロット番号を確認する".to_string(),
            "包装の湿度と乾燥剤を確認する".to_string(),
        ]);
        let certificate = engine.score("材料証明書とロット番号");
        let humidity = engine.score("湿度と乾燥剤");
        assert!(certificate.is_finite());
        assert!(humidity.is_finite());
        assert_ne!(certificate, humidity);
        assert_eq!(engine.score(""), 0.0);
    }

    #[test]
    fn changed_length_handles_multibyte_text() {
        assert_eq!(diff_changed_len("検査A結果", "検査B結果"), 1);
        assert_eq!(diff_changed_len("前🙂後", "前🙂後"), 0);
        assert_eq!(diff_changed_len("", "追記"), 2);
    }
}
