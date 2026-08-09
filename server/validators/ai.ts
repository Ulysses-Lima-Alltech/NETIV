import { z } from 'zod';

/** Nomes de campo legados (openai*) — resolvem para Bedrock hoje; mantidos do tempo em que o projeto ainda suportava OpenAI. */
export const openAISettingUpdateSchema = z.object({
  openaiApiKey: z.string().optional(),
  removeApiKey: z.boolean().optional(),
  openaiApiKeyId: z.string().nullable().optional(),
  openaiProjectId: z.string().nullable().optional(),
  openaiBaseUrl: z.string().nullable().optional(),
  modelColdLead: z.string().optional(),
  modelHotLead: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(4096).optional(),
  leadScoreThreshold: z.number().min(0).max(1).optional(),
  aiEnabled: z.boolean().optional(),
});

export type OpenAISettingUpdateDto = z.infer<typeof openAISettingUpdateSchema>;

export const globalAiSettingUpdateSchema = z.object({
  provider: z.literal('openai').optional(),
  openai_api_key: z.string().optional(),
  remove_api_key: z.boolean().optional(),
  openai_api_key_id: z.string().nullable().optional(),
  openai_project_id: z.string().nullable().optional(),
  openai_base_url: z.string().nullable().optional(),
  model_hot_lead: z.string().nullable().optional(),
  model_cold_lead: z.string().nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(4096).optional(),
  lead_score_threshold: z.number().min(0).max(1).optional(),
  ai_enabled: z.boolean().optional(),
});

export type GlobalAiSettingUpdateDto = z.infer<typeof globalAiSettingUpdateSchema>;

export const enterpriseAiSettingUpdateSchema = z.object({
  provider: z.literal('openai').optional(),
  use_global_defaults: z.boolean().optional(),
  openai_api_key: z.string().optional(),
  remove_api_key: z.boolean().optional(),
  openai_api_key_id: z.string().nullable().optional(),
  openai_project_id: z.string().nullable().optional(),
  openai_base_url: z.string().nullable().optional(),
  model_hot_lead: z.string().nullable().optional(),
  model_cold_lead: z.string().nullable().optional(),
  ai_enabled: z.boolean().optional(),
  emergency_block_enabled: z.boolean().optional(),
  emergency_block_message: z.string().nullable().optional(),
  cost_tracking_enabled: z.boolean().optional(),
});

export type EnterpriseAiSettingUpdateDto = z.infer<typeof enterpriseAiSettingUpdateSchema>;

export const openAiCostSettingUpdateSchema = z.object({
  provider: z.literal('openai').optional(),
  openai_costs_api_key: z.string().optional(),
  remove_api_key: z.boolean().optional(),
  openai_costs_api_key_id: z.string().nullable().optional(),
  openai_project_id: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export type OpenAiCostSettingUpdateDto = z.infer<typeof openAiCostSettingUpdateSchema>;
