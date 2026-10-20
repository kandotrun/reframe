# Explanation API

`POST /api/explain` accepts a bounded JSON request:

```json
{
  "query": "検査条件の変更で何を再確認しますか？",
  "caseTitle": "架空部品の納期回答",
  "evidence": [
    { "id": "spec-r2", "text": "仕様書 第2版: 出荷前の検査記録を追加する。" }
  ]
}
```

The browser selects evidence through local retrieval, then explicitly submits those excerpts and the question to the Worker. Inference runs through Cloudflare Workers AI. Neither the Worker nor its budget coordinator stores questions or evidence. The provider still processes submitted content; use fictional examples in this public demo.

Successful responses always distinguish generated text from literal extraction:

```json
{
  "text": "検査記録が追加されています。担当者による確認が必要です。[spec-r2]",
  "mode": "generated",
  "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "citations": ["spec-r2"]
}
```

`mode: "extractive"` means the API returned source excerpts, not a language-model answer. Its `error` is one of `rate_limited`, `daily_budget_exhausted`, `generation_unavailable`, `generation_timeout`, or `citation_validation_failed`. These responses remain HTTP 200 so the interface can still display useful evidence. They do not include a model name. A malformed request instead returns HTTP 4xx and `{ "error": { "code": "...", "message": "..." } }`.

## Bounds and cost controls

- Request body: at most 12 KiB, checked while reading the actual stream. Body read deadline: 5 seconds.
- Question: 1–500 characters; case title: 1–160 characters.
- Evidence: 1–6 unique source IDs; each text: 1–1,600 characters. IDs use ASCII letters, digits, `.`, `_`, `:`, or `-`, at most 64 characters.
- Same-origin JSON requests only. Origin validation prevents browser cross-site use, but is not authentication: non-browser callers can forge that header.
- Five requests per IP per minute at a Cloudflare location. The platform limiter is approximate and per location; it is **not** global accounting. Shared IPs share this allowance.
- One SQLite-backed Durable Object reserves at most **60 inference attempts per UTC day across this deployment**. A reservation is consumed before contacting AI and is not refunded on timeout, cancellation, provider failure, or invalid output. This caps attempts even if a failed provider call incurred cost.
- One conditional SQL update makes the reservation atomic. Only one row containing a UTC day and count is persisted.
- Generation and its admission checks have a 25-second deadline. Cancellation is passed into `AI.run`. A reservation already in flight may still be counted, but a late reservation cannot start inference after the deadline.
- The model is fixed server-side; maximum output is 600 tokens. No tools, external URLs, or arbitrary model selection are accepted.

The daily attempt cap and per-request token/input limits bound inference usage for this demo, not the entire Cloudflare account bill. The Worker, Durable Object, and asset requests can still incur platform usage.

## Grounding and authority

The system prompt treats every supplied field as untrusted data. Generated source IDs must come from the submitted list, and uncited or invalidly cited output falls back to extraction. This is a citation-format check, **not a proof that each generated claim is supported**. Prompt injection and incorrect synthesis remain model risks; the interface must show the excerpts and mark the result as a draft. No API route approves a business decision or sends a message.

`GET /api/health` confirms the Worker responds and reports the configured model. It does not run inference or prove provider availability. Unknown `/api/*` routes return JSON 404 instead of the single-page app.

Tests stub inference and exercise request validation, cancellation, failure modes, and the actual reservation SQL using SQLite. Live inference is checked separately after deployment.

## Platform references

- [Workers AI model](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)
- [Workers AI binding](https://developers.cloudflare.com/workers-ai/configuration/bindings/)
- [Rate limiting locality and accuracy](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [SQLite-backed Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
