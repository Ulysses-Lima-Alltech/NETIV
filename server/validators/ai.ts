import { z } from 'zod';

export const openAISettingUpdateSchema = z.object({
  openaiApiKey: z.string().optional(),
  openaiBaseUrl: z.string().nullable().optional(),
  modelColdLead: z.string().optional(),
  modelHotLead: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(4096).optional(),
  leadScoreThreshold: z.number().min(0).max(1).optional(),
  aiEnabled: z.boolean().optional(),
});

export type OpenAISettingUpdateDto = z.infer<typeof openAISettingUpdateSchema>;
