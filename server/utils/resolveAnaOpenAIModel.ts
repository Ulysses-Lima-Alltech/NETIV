import { isAllowedOpenAiModel } from '../catalogs/aiModels.js';

export type AnaModelSlot = 'hot_lead' | 'cold_lead';

export interface AnaModelResolutionSuccess {
  blocked: false;
  finalModel: string;
  sourceOfFinalModel: 'db';
  configuredModelFromDb: string;
  slot: AnaModelSlot;
  selectionReason: 'db_config';
}

export interface AnaModelResolutionBlocked {
  blocked: true;
  finalModel: null;
  sourceOfFinalModel: 'db';
  configuredModelFromDb: string | null;
  slot: AnaModelSlot;
  reason: 'ana_model_not_configured' | 'ana_model_invalid_for_slot';
}

export type AnaModelResolution = AnaModelResolutionSuccess | AnaModelResolutionBlocked;

export function resolveAnaOpenAIModel(args: {
  configuredModelFromDb: string | null;
  slot?: AnaModelSlot;
}): AnaModelResolution {
  const slot = args.slot ?? 'hot_lead';
  const configuredModelFromDb = (args.configuredModelFromDb ?? '').trim() || null;

  if (!configuredModelFromDb) {
    return {
      blocked: true,
      finalModel: null,
      sourceOfFinalModel: 'db',
      configuredModelFromDb: null,
      slot,
      reason: 'ana_model_not_configured',
    };
  }

  if (!isAllowedOpenAiModel(configuredModelFromDb)) {
    return {
      blocked: true,
      finalModel: null,
      sourceOfFinalModel: 'db',
      configuredModelFromDb,
      slot,
      reason: 'ana_model_invalid_for_slot',
    };
  }

  return {
    blocked: false,
    finalModel: configuredModelFromDb,
    sourceOfFinalModel: 'db',
    configuredModelFromDb,
    slot,
    selectionReason: 'db_config',
  };
}
