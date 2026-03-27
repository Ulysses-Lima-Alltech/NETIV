/** Default seguro da Ana (WhatsApp) quando DB e OPENAI_MODEL estão vazios. */
export const DEFAULT_ANA_OPENAI_MODEL = 'gpt-4.1';

/** Opcional para retries/fallbacks técnicos — não usado como default principal. */
export const ANA_OPENAI_MODEL_FALLBACK_MINI = 'gpt-4.1-mini';

export interface AnaModelResolution {
  finalModel: string;
  sourceOfFinalModel: 'db' | 'env' | 'default';
  /** Valor efetivo escolhido no banco: hot, senão cold. */
  configuredModelFromDb: string | null;
  configuredModelFromEnv: string | null;
}

/**
 * Precedência: (1) model_hot_lead ou model_cold_lead no integration_settings, se não vazios;
 * (2) OPENAI_MODEL; (3) DEFAULT_ANA_OPENAI_MODEL.
 */
export function resolveAnaOpenAIModel(args: {
  modelHotLeadFromDb: string | null;
  modelColdLeadFromDb: string | null;
}): AnaModelResolution {
  const configuredModelFromEnv = (process.env.OPENAI_MODEL ?? '').trim() || null;
  const hot = args.modelHotLeadFromDb?.trim() || null;
  const cold = args.modelColdLeadFromDb?.trim() || null;
  const configuredModelFromDb = hot ?? cold ?? null;

  if (configuredModelFromDb) {
    return {
      finalModel: configuredModelFromDb,
      sourceOfFinalModel: 'db',
      configuredModelFromDb,
      configuredModelFromEnv,
    };
  }
  if (configuredModelFromEnv) {
    return {
      finalModel: configuredModelFromEnv,
      sourceOfFinalModel: 'env',
      configuredModelFromDb: null,
      configuredModelFromEnv,
    };
  }
  return {
    finalModel: DEFAULT_ANA_OPENAI_MODEL,
    sourceOfFinalModel: 'default',
    configuredModelFromDb: null,
    configuredModelFromEnv: null,
  };
}
