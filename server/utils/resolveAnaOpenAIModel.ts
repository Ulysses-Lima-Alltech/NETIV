/** Default seguro da Ana (WhatsApp) quando DB e OPENAI_MODEL estao vazios. */
export const DEFAULT_ANA_OPENAI_MODEL = 'gpt-4.1';

/** Opcional para retries/fallbacks tecnicos, nao usado como default principal. */
export const ANA_OPENAI_MODEL_FALLBACK_MINI = 'gpt-4.1-mini';
export const DEFAULT_ANA_UNCLASSIFIED_ENTERPRISE_MODEL = 'gpt-4.1-mini';

export interface AnaModelResolution {
  finalModel: string;
  sourceOfFinalModel: 'db' | 'env' | 'default';
  configuredModelFromDb: string | null;
  configuredModelFromEnv: string | null;
  configuredUnclassifiedEnterpriseModelFromEnv: string | null;
  selectionReason: 'unclassified_enterprise_low_cost_model' | 'enterprise_resolved_standard_model';
}

/**
 * Precedencia padrao: (1) model_hot_lead ou model_cold_lead no integration_settings;
 * (2) OPENAI_MODEL; (3) DEFAULT_ANA_OPENAI_MODEL.
 *
 * Para conversas ainda sem empreendimento resolvido, usa o modelo barato dedicado:
 * ANA_UNCLASSIFIED_ENTERPRISE_MODEL ou DEFAULT_ANA_UNCLASSIFIED_ENTERPRISE_MODEL.
 */
export function resolveAnaOpenAIModel(args: {
  modelHotLeadFromDb: string | null;
  modelColdLeadFromDb: string | null;
  enterpriseResolved?: boolean;
}): AnaModelResolution {
  const configuredModelFromEnv = (process.env.OPENAI_MODEL ?? '').trim() || null;
  const configuredUnclassifiedEnterpriseModelFromEnv =
    (process.env.ANA_UNCLASSIFIED_ENTERPRISE_MODEL ?? '').trim() || null;
  const hot = args.modelHotLeadFromDb?.trim() || null;
  const cold = args.modelColdLeadFromDb?.trim() || null;
  const configuredModelFromDb = hot ?? cold ?? null;
  const enterpriseResolved = args.enterpriseResolved !== false;

  if (!enterpriseResolved) {
    return {
      finalModel: configuredUnclassifiedEnterpriseModelFromEnv ?? DEFAULT_ANA_UNCLASSIFIED_ENTERPRISE_MODEL,
      sourceOfFinalModel: configuredUnclassifiedEnterpriseModelFromEnv ? 'env' : 'default',
      configuredModelFromDb,
      configuredModelFromEnv,
      configuredUnclassifiedEnterpriseModelFromEnv,
      selectionReason: 'unclassified_enterprise_low_cost_model',
    };
  }

  if (configuredModelFromDb) {
    return {
      finalModel: configuredModelFromDb,
      sourceOfFinalModel: 'db',
      configuredModelFromDb,
      configuredModelFromEnv,
      configuredUnclassifiedEnterpriseModelFromEnv,
      selectionReason: 'enterprise_resolved_standard_model',
    };
  }
  if (configuredModelFromEnv) {
    return {
      finalModel: configuredModelFromEnv,
      sourceOfFinalModel: 'env',
      configuredModelFromDb: null,
      configuredModelFromEnv,
      configuredUnclassifiedEnterpriseModelFromEnv,
      selectionReason: 'enterprise_resolved_standard_model',
    };
  }
  return {
    finalModel: DEFAULT_ANA_OPENAI_MODEL,
    sourceOfFinalModel: 'default',
    configuredModelFromDb: null,
    configuredModelFromEnv: null,
    configuredUnclassifiedEnterpriseModelFromEnv,
    selectionReason: 'enterprise_resolved_standard_model',
  };
}
