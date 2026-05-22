import {
  CONVERSATION_COMMERCIAL_MOCK,
  CONVERSATION_FALLBACK_MOCK,
  CONVERSATION_MESSAGES_MOCK,
  CONVERSATIONS_MOCK,
} from "../mocks/conversations.mock";
import { AuthUser } from "../types/auth.types";
import {
  Conversation,
  ConversationDetail,
  ConversationMessage,
  ConversationStatus,
} from "../types/conversation.types";

function cloneConversation(conversation: Conversation): Conversation {
  return { ...conversation };
}

function cloneMessages(messages: ConversationMessage[]): ConversationMessage[] {
  return messages.map((message) => ({ ...message }));
}

const conversationsState: Conversation[] = CONVERSATIONS_MOCK.map(cloneConversation);

const messagesState: Record<string, ConversationMessage[]> = Object.entries(
  CONVERSATION_MESSAGES_MOCK
).reduce<Record<string, ConversationMessage[]>>((acc, [conversationId, messages]) => {
  acc[conversationId] = cloneMessages(messages);
  return acc;
}, {});

export function getConversationStatusLabel(
  status: ConversationStatus
): "Ana atendendo" | "Atendimento humano" {
  return status === "HUMAN" ? "Atendimento humano" : "Ana atendendo";
}

function getConversationById(conversationId: string): Conversation {
  const foundConversation = conversationsState.find((conversation) => conversation.id === conversationId);

  if (foundConversation) {
    return foundConversation;
  }

  return { ...CONVERSATION_FALLBACK_MOCK, id: conversationId };
}

export function getConversationsByRole(_user: AuthUser | null | undefined): Promise<Conversation[]> {
  return Promise.resolve(conversationsState.map(cloneConversation));
}

export function getConversationDetailById(
  conversationId: string,
  _user: AuthUser | null | undefined
): Promise<ConversationDetail> {
  const conversation = getConversationById(conversationId);
  const conversationMessages = messagesState[conversationId] ?? [];
  const commercialInfo = CONVERSATION_COMMERCIAL_MOCK[conversationId];

  return Promise.resolve({
    conversation: cloneConversation(conversation),
    messages: cloneMessages(conversationMessages),
    commercialDetails: {
      leadTemperature: commercialInfo?.leadTemperature ?? "Em analise",
      enterpriseName: conversation.enterpriseName,
      brokerName: conversation.assignedBrokerName,
      visitInfo: commercialInfo?.visitInfo ?? "Sem agenda",
      statusLabel: getConversationStatusLabel(conversation.status),
    },
  });
}

export function sendMockMessage(
  conversationId: string,
  text: string
): Promise<ConversationMessage | null> {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return Promise.resolve(null);
  }

  const newMessage: ConversationMessage = {
    id: `${conversationId}-${Date.now()}`,
    from: "me",
    text: normalizedText,
    createdAt: new Date().toISOString(),
  };

  const currentMessages = messagesState[conversationId] ?? [];
  messagesState[conversationId] = [...currentMessages, newMessage];

  const conversationIndex = conversationsState.findIndex((item) => item.id === conversationId);
  if (conversationIndex >= 0) {
    conversationsState[conversationIndex] = {
      ...conversationsState[conversationIndex],
      lastMessage: normalizedText,
      unread: false,
    };
  }

  return Promise.resolve({ ...newMessage });
}

export function toggleMockHandoff(conversationId: string): Promise<Conversation | null> {
  const conversationIndex = conversationsState.findIndex((item) => item.id === conversationId);
  if (conversationIndex < 0) {
    return Promise.resolve(null);
  }

  const currentConversation = conversationsState[conversationIndex];
  const nextStatus: ConversationStatus = currentConversation.status === "HUMAN" ? "ANA" : "HUMAN";

  const updatedConversation: Conversation = {
    ...currentConversation,
    status: nextStatus,
  };

  conversationsState[conversationIndex] = updatedConversation;

  return Promise.resolve(cloneConversation(updatedConversation));
}
