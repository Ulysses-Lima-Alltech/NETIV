import type { ChatMessage } from './openaiService.js';

const SYSTEM_PROMPT =
  'Você é um assistente comercial educado, objetivo e focado em conversão. Ajude o cliente e faça perguntas quando necessário.';

const MAX_HISTORY_MESSAGES = 10;

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function buildPrompt(conversationHistory: HistoryMessage[], userMessage: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

  const recent = conversationHistory.slice(-MAX_HISTORY_MESSAGES);
  for (const m of recent) {
    messages.push({ role: m.role, content: m.content || '(sem texto)' });
  }

  messages.push({ role: 'user', content: userMessage });
  return messages;
}
