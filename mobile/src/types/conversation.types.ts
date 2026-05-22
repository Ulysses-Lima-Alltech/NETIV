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

export type ConversationMessage = {
  id: string;
  from: "client" | "ana" | "me";
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
    visitInfo: string;
    statusLabel: string;
  };
};
