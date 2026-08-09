/** Nomes de campo legados (openai_*) — resolvem para Bedrock hoje; mantidos do tempo em que o projeto ainda suportava OpenAI. */
export interface OpenAIConfig {
  openaiApiKey: string;
  openaiApiKeyId?: string | null;
  openaiProjectId?: string | null;
  openaiBaseUrl: string | null;
  modelColdLead: string;
  modelHotLead: string;
  temperature: number;
  maxTokens: number;
  leadScoreThreshold: number;
  aiEnabled: boolean;
  updatedAt: string;
}

export interface OpenAIConfigPublic {
  openaiApiKeyMasked: boolean;
  openaiApiKeyId?: string | null;
  openaiProjectId?: string | null;
  openaiBaseUrl: string | null;
  modelColdLead: string;
  modelHotLead: string;
  temperature: number;
  maxTokens: number;
  leadScoreThreshold: number;
  aiEnabled: boolean;
  updatedAt: string;
  availableModels?: ReadonlyArray<{
    value: string;
    label: string;
    description: string;
    recommendedFor: 'hot' | 'cold' | 'advanced' | 'realtime';
    costTier?: 'muito baixo' | 'baixo' | 'médio' | 'médio/alto' | 'alto' | 'variável';
    costHint?: string;
  }>;
}

export interface OpenAIConfigUpdate {
  openaiApiKey?: string;
  removeApiKey?: boolean;
  openaiApiKeyId?: string | null;
  openaiProjectId?: string | null;
  openaiBaseUrl?: string | null;
  modelColdLead?: string;
  modelHotLead?: string;
  temperature?: number;
  maxTokens?: number;
  leadScoreThreshold?: number;
  aiEnabled?: boolean;
}
