export interface LlmModelPrice {
  inputUsdPer1M: number;
  cachedInputUsdPer1M?: number;
  outputUsdPer1M: number;
}

export interface LlmCostInput {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface LlmCostEstimate {
  estimatedCostUsd: number;
  priceMissing: boolean;
  price: LlmModelPrice | null;
}

const DEFAULT_MODEL_PRICES_USD_PER_1M: Record<string, LlmModelPrice> = {
  'gpt-4.1': { inputUsdPer1M: 2, cachedInputUsdPer1M: 0.5, outputUsdPer1M: 8 },
  'gpt-4.1-mini': { inputUsdPer1M: 0.4, cachedInputUsdPer1M: 0.1, outputUsdPer1M: 1.6 },
  'gpt-4.1-nano': { inputUsdPer1M: 0.1, cachedInputUsdPer1M: 0.025, outputUsdPer1M: 0.4 },
  'gpt-4o': { inputUsdPer1M: 2.5, cachedInputUsdPer1M: 1.25, outputUsdPer1M: 10 },
  'gpt-4o-mini': { inputUsdPer1M: 0.15, cachedInputUsdPer1M: 0.075, outputUsdPer1M: 0.6 },
};

function sanitizeTokenCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function normalizeModelName(model: string): string {
  return (model || '').trim().toLowerCase();
}

function parsePriceMapFromEnv(): Record<string, LlmModelPrice> {
  const raw = process.env.ANA_LLM_MODEL_PRICING_JSON ?? process.env.LLM_MODEL_PRICING_JSON ?? '';
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<LlmModelPrice>>;
    const out: Record<string, LlmModelPrice> = {};
    for (const [model, price] of Object.entries(parsed)) {
      const inputUsdPer1M = Number(price.inputUsdPer1M);
      const outputUsdPer1M = Number(price.outputUsdPer1M);
      const cachedInputUsdPer1M =
        price.cachedInputUsdPer1M == null ? undefined : Number(price.cachedInputUsdPer1M);
      if (!Number.isFinite(inputUsdPer1M) || !Number.isFinite(outputUsdPer1M)) continue;
      out[normalizeModelName(model)] = {
        inputUsdPer1M,
        outputUsdPer1M,
        ...(Number.isFinite(cachedInputUsdPer1M) ? { cachedInputUsdPer1M } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function getLlmModelPrice(model: string): LlmModelPrice | null {
  const normalized = normalizeModelName(model);
  const envPrices = parsePriceMapFromEnv();
  return envPrices[normalized] ?? DEFAULT_MODEL_PRICES_USD_PER_1M[normalized] ?? null;
}

export function estimateLlmCostUsd(input: LlmCostInput): LlmCostEstimate {
  const price = getLlmModelPrice(input.model);
  if (!price) {
    return { estimatedCostUsd: 0, priceMissing: true, price: null };
  }
  const inputTokens = sanitizeTokenCount(input.inputTokens);
  const cachedInputTokens = Math.min(sanitizeTokenCount(input.cachedInputTokens), inputTokens);
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const outputTokens = sanitizeTokenCount(input.outputTokens);
  const cachedInputPrice = price.cachedInputUsdPer1M ?? price.inputUsdPer1M;
  const estimatedCostUsd =
    (uncachedInputTokens * price.inputUsdPer1M +
      cachedInputTokens * cachedInputPrice +
      outputTokens * price.outputUsdPer1M) /
    1_000_000;
  return {
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    priceMissing: false,
    price,
  };
}
