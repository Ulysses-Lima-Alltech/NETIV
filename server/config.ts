const env = process.env;

const defaultOpenAIBaseUrl = 'https://api.openai.com/v1';
const defaultOpenAIModel = 'gpt-4.1-mini';
const defaultMetaApiVersion = 'v23.0';

export const config = {
  port: parseInt(env.PORT ?? '3001', 10),
  nodeEnv: env.NODE_ENV ?? 'development',
  dbPath: env.DB_PATH ?? './data/inbox.db',
  metaApiVersion: env.META_API_VERSION ?? 'v21.0',
  openai: {
    apiKey: env.OPENAI_API_KEY ?? '',
    baseUrl: (env.OPENAI_BASE_URL ?? defaultOpenAIBaseUrl).replace(/\/$/, ''),
    model: env.OPENAI_MODEL ?? defaultOpenAIModel,
  },
  meta: {
    verifyToken: env.META_VERIFY_TOKEN ?? '',
    whatsappToken: env.META_WHATSAPP_TOKEN ?? '',
    phoneNumberId: env.META_PHONE_NUMBER_ID ?? '',
    apiVersion: env.META_API_VERSION ?? defaultMetaApiVersion,
  },
} as const;
