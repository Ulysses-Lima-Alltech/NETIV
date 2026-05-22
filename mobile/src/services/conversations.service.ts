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
import { requestJson } from "./api";

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

type MobileConversationsResponse = {
  conversations: Conversation[];
};

function isConversationStatus(value: unknown): value is ConversationStatus {
  return value === "ANA" || value === "HUMAN";
}

function normalizeConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<Conversation>;
  if (typeof value.id !== "string") return null;
  if (typeof value.clientName !== "string") return null;
  if (typeof value.enterpriseName !== "string") return null;
  if (typeof value.lastMessage !== "string") return null;
  if (!isConversationStatus(value.status)) return null;
  if (typeof value.needsHuman !== "boolean") return null;
  if (typeof value.unread !== "boolean") return null;
  if (value.assignedBrokerName !== null && typeof value.assignedBrokerName !== "string") return null;

  return {
    id: value.id,
    clientName: value.clientName,
    enterpriseName: value.enterpriseName,
    lastMessage: value.lastMessage,
    status: value.status,
    needsHuman: value.needsHuman,
    unread: value.unread,
    assignedBrokerName: value.assignedBrokerName ?? null,
  };
}

export async function getConversationsWithApi(token: string): Promise<Conversation[]> {
  const response = await requestJson<MobileConversationsResponse>("/api/mobile/conversations", {
    method: "GET",
    token,
  });

  if (!Array.isArray(response?.conversations)) {
    throw new Error("INVALID_CONVERSATIONS_PAYLOAD");
  }

  const normalized = response.conversations
    .map((item) => normalizeConversation(item))
    .filter((item): item is Conversation => item !== null);

  return normalized;
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
