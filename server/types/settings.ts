export interface WhatsAppIntegrationConfig {
  metaAccessToken: string;
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string;
  apiVersion: string;
  webhookVerifyToken: string;
  defaultSendPhoneNumber: string | null;
  defaultCountryCode: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppIntegrationConfigPublic {
  metaAccessTokenMasked: boolean;
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string;
  apiVersion: string;
  webhookVerifyTokenMasked: boolean;
  defaultSendPhoneNumber: string | null;
  defaultCountryCode: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppIntegrationConfigUpdate {
  metaAccessToken?: string;
  whatsappPhoneNumberId?: string;
  whatsappBusinessAccountId?: string;
  apiVersion?: string;
  webhookVerifyToken?: string;
  defaultSendPhoneNumber?: string | null;
  defaultCountryCode?: string | null;
  enabled?: boolean;
}
