export type ConversationStatus = "ANA" | "HUMAN";

export type Conversation = {
  id: string;
  clientName: string;
  enterpriseName: string;
  lastMessage: string;
  status: ConversationStatus;
  needsHuman: boolean;
  unread: boolean;
  assignedBrokerName: string | null;
};

export type ConversationListType = "CLIENT" | "INTERNO";

export type ConversationMessageDirection = "INBOUND" | "OUTBOUND" | "SYSTEM";

export type ConversationMessage = {
  id: string;
  from: "client" | "ana" | "me" | "system";
  direction?: ConversationMessageDirection;
  text: string;
  createdAt?: string;
};

export type ConversationDetail = {
  conversation: Conversation;
  messages: ConversationMessage[];
  commercialDetails: {
    leadTemperature: string;
    enterpriseName: string;
    brokerName: string | null;
    visitInfo: string | null;
    statusLabel: string;
  };
};
