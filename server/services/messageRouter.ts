import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { generateChatCompletion } from './openaiService.js';
import type { ChatMessage } from './openaiService.js';
import { detectLeadScore } from './leadScoring.js';
import type { LeadStage } from './leadAnalyzer.js';

export interface RouteMessageResult {
  success: boolean;
  content?: string;
  modelUsed?: string;
  leadScore?: number;
  error?: string;
}

export async function routeAndGenerate(
  messages: ChatMessage[],
  userMessage: string,
  leadStage?: LeadStage
): Promise<RouteMessageResult> {
  const config = await getOpenAIConfig();
  if (!config?.openaiApiKey?.trim()) {
    return { success: false, error: 'OpenAI API Key não configurada.' };
  }

  let model: string;
  if (leadStage === 'HOT') {
    model = config.modelHotLead ?? 'gpt-4.1';
  } else if (leadStage === 'WARM' || leadStage === 'COLD') {
    model = config.modelColdLead ?? 'gpt-4.1-mini';
  } else {
    const leadScore = detectLeadScore(userMessage);
    const threshold = config.leadScoreThreshold ?? 0.75;
    model =
      (leadScore >= threshold ? config.modelHotLead : config.modelColdLead) ?? config.modelColdLead ?? 'gpt-4.1';
  }

  const result = await generateChatCompletion({
    apiKey: config.openaiApiKey,
    baseUrl: config.openaiBaseUrl,
    model,
    messages,
    temperature: config.temperature ?? 0.4,
    maxTokens: config.maxTokens ?? 500,
  });

  if (result.success) {
    const leadScore = detectLeadScore(userMessage);
    return {
      success: true,
      content: result.content,
      modelUsed: model,
      leadScore,
    };
  }
  return {
    success: false,
    error: result.error,
    leadScore: detectLeadScore(userMessage),
  };
}
