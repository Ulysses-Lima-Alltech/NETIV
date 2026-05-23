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
  ConversationMessageDirection,
  ConversationStatus,
  ConversationListType,
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
): "Atendimento Autonomo" | "Atendimento Humano" {
  return status === "HUMAN" ? "Atendimento Humano" : "Atendimento Autonomo";
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

type MobileConversationDetailResponse = {
  conversation: Conversation;
  commercialDetails: ConversationDetail["commercialDetails"];
  messages: ConversationMessage[];
};

type MobileHandoffResponse = {
  conversation: {
    id: string;
    status: ConversationStatus;
    needsHuman: boolean;
    assignedBrokerName: string | null;
  };
};

type MobileSendMessageResponse = {
  message: {
    id: string;
    from: "me";
    direction?: "OUTBOUND";
    text: string;
    createdAt: string;
  };
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

function normalizeConversationMessage(raw: unknown): ConversationMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<ConversationMessage>;
  if (typeof value.id !== "string") return null;
  if (value.from !== "client" && value.from !== "ana" && value.from !== "me" && value.from !== "system") return null;
  if (typeof value.text !== "string") return null;
  if (value.createdAt !== undefined && value.createdAt !== null && typeof value.createdAt !== "string") return null;
  const rawDirection = (value as { direction?: unknown }).direction;
  let direction: ConversationMessageDirection | undefined;
  if (rawDirection === "INBOUND" || rawDirection === "OUTBOUND" || rawDirection === "SYSTEM") {
    direction = rawDirection;
  } else if (value.from === "client") {
    direction = "INBOUND";
  } else if (value.from === "system") {
    direction = "SYSTEM";
  } else {
    direction = "OUTBOUND";
  }

  return {
    id: value.id,
    from: value.from,
    direction,
    text: value.text,
    createdAt: value.createdAt ?? undefined,
  };
}

function normalizeConversationDetail(raw: unknown): ConversationDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<MobileConversationDetailResponse>;
  const conversation = normalizeConversation(value.conversation);
  if (!conversation) return null;

  const commercial = value.commercialDetails;
  if (!commercial || typeof commercial !== "object") return null;

  const commercialDetails = commercial as Partial<ConversationDetail["commercialDetails"]>;
  if (typeof commercialDetails.leadTemperature !== "string") return null;
  if (typeof commercialDetails.enterpriseName !== "string") return null;
  if (commercialDetails.brokerName !== null && typeof commercialDetails.brokerName !== "string") return null;
  if (commercialDetails.visitInfo !== null && commercialDetails.visitInfo !== undefined && typeof commercialDetails.visitInfo !== "string") return null;
  if (typeof commercialDetails.statusLabel !== "string") return null;

  if (!Array.isArray(value.messages)) return null;
  const messages = value.messages
    .map((item) => normalizeConversationMessage(item))
    .filter((item): item is ConversationMessage => item !== null);

  return {
    conversation,
    commercialDetails: {
      leadTemperature: commercialDetails.leadTemperature,
      enterpriseName: commercialDetails.enterpriseName,
      brokerName: commercialDetails.brokerName ?? null,
      visitInfo: commercialDetails.visitInfo ?? null,
      statusLabel: commercialDetails.statusLabel,
    },
    messages,
  };
}

export async function getConversationsWithApi(
  token: string,
  type: ConversationListType
): Promise<Conversation[]> {
  const response = await requestJson<MobileConversationsResponse>(`/api/mobile/conversations?type=${type}`, {
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

export async function getConversationDetailWithApi(
  conversationId: string,
  token: string
): Promise<ConversationDetail> {
  const response = await requestJson<MobileConversationDetailResponse>(
    `/api/mobile/conversations/${conversationId}`,
    {
      method: "GET",
      token,
    }
  );

  const normalized = normalizeConversationDetail(response);
  if (!normalized) {
    throw new Error("INVALID_CONVERSATION_DETAIL_PAYLOAD");
  }

  return normalized;
}

export async function toggleHandoffWithApi(
  conversationId: string,
  handoff: boolean,
  token: string
): Promise<Conversation | null> {
  const response = await requestJson<MobileHandoffResponse>(
    `/api/mobile/conversations/${conversationId}/handoff`,
    {
      method: "PATCH",
      token,
      body: { handoff },
    }
  );

  if (!response?.conversation?.id || !isConversationStatus(response.conversation.status)) {
    throw new Error("INVALID_HANDOFF_PAYLOAD");
  }

  const current = getConversationById(conversationId);
  return {
    ...current,
    id: response.conversation.id,
    status: response.conversation.status,
    needsHuman: response.conversation.needsHuman === true,
    assignedBrokerName: response.conversation.assignedBrokerName ?? null,
  };
}

export async function sendMessageWithApi(
  conversationId: string,
  text: string,
  token: string
): Promise<ConversationMessage | null> {
  const normalizedText = text.trim();
  if (!normalizedText) return null;

  const response = await requestJson<MobileSendMessageResponse>(
    `/api/mobile/conversations/${conversationId}/messages`,
    {
      method: "POST",
      token,
      body: { text: normalizedText },
    }
  );

  if (
    !response?.message?.id ||
    response.message.from !== "me" ||
    typeof response.message.text !== "string"
  ) {
    throw new Error("INVALID_SEND_MESSAGE_PAYLOAD");
  }

  return {
    id: response.message.id,
    from: "me",
    direction: "OUTBOUND",
    text: response.message.text,
    createdAt: response.message.createdAt,
  };
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
    direction: "OUTBOUND",
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
