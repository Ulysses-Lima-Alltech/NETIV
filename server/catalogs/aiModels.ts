export type OpenAiModelRecommendedFor = 'hot' | 'cold' | 'advanced' | 'realtime';

export interface OpenAiAllowedModelItem {
  value: string;
  label: string;
  description: string;
  recommendedFor: OpenAiModelRecommendedFor;
}

export const OPENAI_ALLOWED_MODELS: readonly OpenAiAllowedModelItem[] = [
  {
    value: 'gpt-5.1',
    label: 'GPT-5.1',
    description: 'Modelo mais forte para leads quentes e atendimentos críticos',
    recommendedFor: 'hot',
  },
  {
    value: 'gpt-5-mini',
    label: 'GPT-5 mini',
    description: 'Equilíbrio entre qualidade, custo e velocidade',
    recommendedFor: 'cold',
  },
  {
    value: 'gpt-5-nano',
    label: 'GPT-5 nano',
    description: 'Modelo leve para triagem e perguntas simples',
    recommendedFor: 'cold',
  },
  {
    value: 'gpt-4.1',
    label: 'GPT-4.1',
    description: 'Modelo forte para leads quentes',
    recommendedFor: 'hot',
  },
  {
    value: 'gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    description: 'Bom custo-benefício para atendimento geral',
    recommendedFor: 'cold',
  },
  {
    value: 'gpt-4.1-nano',
    label: 'GPT-4.1 nano',
    description: 'Modelo leve para triagem',
    recommendedFor: 'cold',
  },
  {
    value: 'o3',
    label: 'o3',
    description: 'Modelo de raciocínio avançado; usar com cuidado pelo custo/latência',
    recommendedFor: 'advanced',
  },
  {
    value: 'o4-mini',
    label: 'o4-mini',
    description: 'Modelo de raciocínio mais leve',
    recommendedFor: 'advanced',
  },
  {
    value: 'gpt-4o',
    label: 'GPT-4o',
    description: 'Modelo robusto e multimodal',
    recommendedFor: 'hot',
  },
  {
    value: 'gpt-4o-realtime-preview',
    label: 'GPT-4o realtime preview',
    description: 'Modelo realtime/preview; não recomendado para fluxo normal de WhatsApp texto',
    recommendedFor: 'realtime',
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
