export type ConversationStatus = "ANA" | "HUMAN";

export type Conversation = {
  id: string;
  clientName: string;
  enterpriseName: string;
  lastMessage: string;
  status: ConversationStatus;
  needsHuman: boolean;
  unread: boolean;
  assignedBrokerName: string;
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
    brokerName: string;
    visitInfo: string;
    statusLabel: string;
  };
};
