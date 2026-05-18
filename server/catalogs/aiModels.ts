export type OpenAiModelRecommendedFor = 'hot' | 'cold' | 'advanced' | 'realtime';

export interface OpenAiAllowedModelItem {
  value: string;
  label: string;
  description: string;
  recommendedFor: OpenAiModelRecommendedFor;
  costTier?: 'muito baixo' | 'baixo' | 'médio' | 'médio/alto' | 'alto' | 'variável';
  costHint?: string;
}

export const OPENAI_ALLOWED_MODELS: readonly OpenAiAllowedModelItem[] = [
  {
    value: 'gpt-5.1',
    label: 'GPT-5.1',
    description: 'Modelo mais forte para leads quentes e atendimentos cr\u00edticos',
    recommendedFor: 'hot',
    costTier: 'alto',
    costHint: 'Mais caro; usar para leads quentes e casos críticos',
  },
  {
    value: 'gpt-5-mini',
    label: 'GPT-5 mini',
    description: 'Equil\u00edbrio entre qualidade, custo e velocidade',
    recommendedFor: 'cold',
    costTier: 'médio',
    costHint: 'Equilíbrio entre qualidade, custo e velocidade',
  },
  {
    value: 'gpt-5-nano',
    label: 'GPT-5 nano',
    description: 'Modelo leve para triagem e perguntas simples',
    recommendedFor: 'cold',
    costTier: 'baixo',
    costHint: 'Baixo custo; indicado para triagem e perguntas simples',
  },
  {
    value: 'gpt-4.1',
    label: 'GPT-4.1',
    description: 'Modelo mais forte para leads quentes e atendimentos cr\u00edticos',
    recommendedFor: 'hot',
    costTier: 'médio/alto',
    costHint: 'Modelo forte; usar para leads quentes',
  },
  {
    value: 'gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    description: 'Bom custo-benef\u00edcio para atendimento geral',
    recommendedFor: 'cold',
    costTier: 'baixo',
    costHint: 'Bom custo-benefício para atendimento geral',
  },
  {
    value: 'gpt-4.1-nano',
    label: 'GPT-4.1 nano',
    description: 'Modelo leve para triagem e perguntas simples',
    recommendedFor: 'cold',
    costTier: 'muito baixo',
    costHint: 'Modelo leve para triagem',
  },
  {
    value: 'o3',
    label: 'o3',
    description: 'Modelo de racioc\u00ednio avan\u00e7ado; usar com cuidado pelo custo/lat\u00eancia',
    recommendedFor: 'advanced',
    costTier: 'alto',
    costHint: 'Raciocínio avançado; usar com cuidado pelo custo e latência',
  },
  {
    value: 'o4-mini',
    label: 'o4-mini',
    description: 'Modelo de racioc\u00ednio mais leve',
    recommendedFor: 'advanced',
    costTier: 'médio',
    costHint: 'Raciocínio mais leve',
  },
  {
    value: 'gpt-4o',
    label: 'GPT-4o',
    description: 'Modelo robusto e multimodal',
    recommendedFor: 'hot',
    costTier: 'médio/alto',
    costHint: 'Modelo robusto e multimodal',
  },
  {
    value: 'gpt-4o-realtime-preview',
    label: 'GPT-4o realtime preview',
    description: 'Modelo realtime/preview; n\u00e3o recomendado para fluxo normal de WhatsApp texto',
    recommendedFor: 'realtime',
    costTier: 'variável',
    costHint: 'Uso específico para realtime/preview; não recomendado para WhatsApp texto comum',
  },
] as const;

const ALLOWED_MODEL_SET = new Set(OPENAI_ALLOWED_MODELS.map((item) => item.value));

export function isAllowedOpenAiModel(model: string): boolean {
  return ALLOWED_MODEL_SET.has(String(model).trim());
}

export function getDefaultOpenAiModelHot(): string {
  return 'gpt-4.1';
}

export function getDefaultOpenAiModelCold(): string {
  return 'gpt-4.1-mini';
}
