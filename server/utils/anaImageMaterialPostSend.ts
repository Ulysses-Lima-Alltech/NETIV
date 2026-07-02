import type { ChatMessage } from '../services/openaiService.js';
import type { AnaImageFilenameTopic } from './anaDocSendIntent.js';

export const ANA_IMAGE_MATERIAL_POST_SEND_FALLBACK_TEXT = 'Te enviei as imagens. O que achou?';

export interface AnaImageMaterialPostSendContext {
  requestedTheme: AnaImageFilenameTopic | null;
  sentImages: readonly string[];
  lastUserMessage: string;
  enterpriseName?: string | null;
  commercialContext?: string | null;
}

function cleanContextValue(value: string | null | undefined, maxChars: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function formatTheme(theme: AnaImageFilenameTopic | null): string {
  return theme ? theme.replace(/_/g, ' ') : 'pedido generico de imagens';
}

function formatSentImages(sentImages: readonly string[]): string {
  const names = sentImages.map((name) => cleanContextValue(name, 220)).filter(Boolean);
  if (names.length === 0) return 'imagens enviadas sem nome de arquivo disponivel';
  return names.map((name) => `- ${name}`).join('\n');
}

function formatVariablesMap(variablesMap: Record<string, unknown> | null | undefined): string {
  const lines = Object.entries(variablesMap ?? {})
    .map(([key, value]) => [cleanContextValue(key, 90), cleanContextValue(String(value ?? ''), 260)] as const)
    .filter(([key, value]) => key && value)
    .slice(0, 30)
    .map(([key, value]) => `- ${key}: ${value}`);
  return lines.length > 0 ? lines.join('\n') : '';
}

export function buildAnaImageMaterialCommercialContext(params: {
  enterpriseName?: string | null;
  variablesMap?: Record<string, unknown> | null;
  knowledgeText?: string | null;
  fileInventory?: string | null;
}): string {
  const parts: string[] = [];
  const enterpriseName = cleanContextValue(params.enterpriseName ?? null, 180);
  if (enterpriseName) parts.push(`Empreendimento: ${enterpriseName}`);

  const variables = formatVariablesMap(params.variablesMap ?? null);
  if (variables) parts.push(`Variaveis comerciais disponiveis:\n${variables}`);

  const knowledge = cleanContextValue(params.knowledgeText ?? null, 3000);
  if (knowledge) parts.push(`Base comercial/RAG disponivel:\n${knowledge}`);

  const inventory = cleanContextValue(params.fileInventory ?? null, 1200);
  if (inventory) parts.push(`Arquivos liberados para cliente:\n${inventory}`);

  return parts.join('\n\n').slice(0, 4500);
}

export function buildAnaImageMaterialPostSendMessages(ctx: AnaImageMaterialPostSendContext): ChatMessage[] {
  const theme = formatTheme(ctx.requestedTheme);
  const lastUserMessage = cleanContextValue(ctx.lastUserMessage, 900);
  const enterpriseName = cleanContextValue(ctx.enterpriseName ?? null, 180);
  const commercialContext = cleanContextValue(ctx.commercialContext ?? null, 4500);

  const contextLines = [
    '[CONTEXTO INTERNO - NAO MOSTRAR AO CLIENTE]',
    enterpriseName ? `Empreendimento: ${enterpriseName}` : null,
    `Ultima mensagem do cliente: ${JSON.stringify(lastUserMessage)}`,
    `Tema de imagem identificado: ${theme}`,
    'Imagens ja enviadas ao cliente:',
    formatSentImages(ctx.sentImages),
    'Status do envio: as imagens listadas acima ja foram enviadas ao cliente antes desta resposta textual.',
    commercialContext ? `Contexto comercial disponivel:\n${commercialContext}` : null,
    '[/CONTEXTO INTERNO]',
  ].filter((line): line is string => Boolean(line));

  return [
    {
      role: 'system',
      content: [
        'Voce e a Ana, assistente comercial da NETIV.',
        'Responda em portugues do Brasil, de forma natural, curta e comercial.',
        'Use a ultima mensagem do cliente e o contexto das imagens ja enviadas.',
        'A imagem ja foi enviada ao cliente; nao diga que vai enviar se ela ja foi enviada.',
        'Nao diga que nao tem foto, porque a foto ja foi enviada.',
        'Nao acione corretor automaticamente e nao crie handoff.',
        'Nao invente informacoes alem da base comercial disponivel no contexto.',
        'Se a pergunta composta do cliente trouxer um comentario ou uma duvida, responda essa duvida de forma breve antes de continuar a conversa.',
        'Nao use template fixo por tema como resposta principal.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: contextLines.join('\n'),
    },
  ];
}
