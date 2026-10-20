import { GENERATION_MODEL, handleRequest } from './app';

export { DraftBudget } from './budget';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      generate: (input, signal) => env.AI.run(GENERATION_MODEL, input, { signal }),
      rateLimit: async (key) => (await env.RATE_LIMITER.limit({ key })).success,
      reserveBudget: () => env.AI_BUDGET.getByName('public-drafts-v1').reserve(),
      fetchAsset: (assetRequest) => env.ASSETS.fetch(assetRequest),
    });
  },
} satisfies ExportedHandler<Env>;
