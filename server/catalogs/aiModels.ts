/** Nome legado — catálogo hoje só é consultado no path Bedrock; mantido do tempo em que o projeto ainda suportava OpenAI. */
export type OpenAiModelRecommendedFor = 'hot' | 'cold' | 'advanced' | 'realtime';
export type AiModelProvider = 'openai' | 'openrouter' | 'local' | 'custom';

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

export const OPENROUTER_ALLOWED_MODELS: readonly OpenAiAllowedModelItem[] = [
  {
    value: 'openai/gpt-4.1',
    label: 'OpenRouter - GPT-4.1',
    description: 'Slug OpenRouter para GPT-4.1',
    recommendedFor: 'hot',
    costTier: 'médio/alto',
    costHint: 'Use quando o provider/base URL estiver em OpenRouter',
  },
  {
    value: 'openai/gpt-4.1-mini',
    label: 'OpenRouter - GPT-4.1 mini',
    description: 'Slug OpenRouter para GPT-4.1 mini',
    recommendedFor: 'cold',
    costTier: 'baixo',
    costHint: 'Use quando o provider/base URL estiver em OpenRouter',
  },
  {
    value: 'openai/gpt-4.1-nano',
    label: 'OpenRouter - GPT-4.1 nano',
    description: 'Slug OpenRouter para GPT-4.1 nano',
    recommendedFor: 'cold',
    costTier: 'muito baixo',
    costHint: 'Use quando o provider/base URL estiver em OpenRouter',
  },
] as const;

const ALLOWED_MODEL_SET_OPENAI = new Set(OPENAI_ALLOWED_MODELS.map((item) => item.value));
const ALLOWED_MODEL_SET_OPENROUTER = new Set(OPENROUTER_ALLOWED_MODELS.map((item) => item.value));
const LOCAL_ALLOWED_MODEL_EXACT = new Set([
  'ana-evora-qwen-8k-v2:latest',
  'ana-evora-qwen-8k:latest',
  'qwen2.5:7b-instruct',
]);

export const LOCAL_ALLOWED_MODELS: readonly OpenAiAllowedModelItem[] = [
  {
    value: 'ana-evora-qwen-8k-v2:latest',
    label: 'Local - Ana Evora Qwen 8K v2',
    description: 'Modelo local customizado para a Ana (temporario)',
    recommendedFor: 'hot',
    costTier: 'baixo',
    costHint: 'Uso em proxy/tunel local temporario',
  },
  {
    value: 'ana-evora-qwen-8k:latest',
    label: 'Local - Ana Evora Qwen 8K',
    description: 'Versao anterior do modelo local da Ana',
    recommendedFor: 'cold',
    costTier: 'baixo',
    costHint: 'Fallback local',
  },
  {
    value: 'qwen2.5:7b-instruct',
    label: 'Local - Qwen2.5 7B Instruct',
    description: 'Modelo Qwen local compativel com endpoint OpenAI-like',
    recommendedFor: 'cold',
    costTier: 'baixo',
    costHint: 'Uso local/custom',
  },
] as const;

function normalizeProviderOrBaseUrl(input?: string | null): AiModelProvider {
  const raw = String(input ?? '').trim().toLowerCase();
  if (raw === 'openrouter' || raw.includes('openrouter.ai')) return 'openrouter';
  if (raw === 'openai' || raw.includes('api.openai.com')) return 'openai';
  if (raw === 'local' || raw === 'custom' || raw === 'unknown') return 'local';
  return 'local';
}

function isAllowedLocalCustomModel(model: string): boolean {
  const normalized = String(model).trim().toLowerCase();
  if (!normalized) return false;
  if (LOCAL_ALLOWED_MODEL_EXACT.has(normalized)) return true;
  return (
    normalized.startsWith('qwen') ||
    normalized.startsWith('ana-qwen') ||
    normalized.startsWith('ana-evora-qwen')
  );
}

export function getAllowedOpenAiModels(providerOrBaseUrl?: string | null): readonly OpenAiAllowedModelItem[] {
  const provider = normalizeProviderOrBaseUrl(providerOrBaseUrl);
  if (provider === 'openrouter') return OPENROUTER_ALLOWED_MODELS;
  if (provider === 'openai') return OPENAI_ALLOWED_MODELS;
  return LOCAL_ALLOWED_MODELS;
}

export function isAllowedOpenAiModel(model: string, providerOrBaseUrl?: string | null): boolean {
  const normalizedModel = String(model).trim();
  const provider = normalizeProviderOrBaseUrl(providerOrBaseUrl);
  if (provider === 'openrouter') return ALLOWED_MODEL_SET_OPENROUTER.has(normalizedModel);
  if (provider === 'openai') return ALLOWED_MODEL_SET_OPENAI.has(normalizedModel);
  return isAllowedLocalCustomModel(normalizedModel);
}

export function getDefaultOpenAiModelHot(): string {
  return 'gpt-4.1';
}

export function getDefaultOpenAiModelCold(): string {
  return 'gpt-4.1-mini';
}
