export interface WebhookVerificationQuery {
  'hub.mode': string;
  'hub.verify_token': string;
  'hub.challenge': string;
}

export interface WebhookEntry {
  id: string;
  changes: Array<{
    field: string;
    value: {
      messaging_product: string;
      metadata: {
        display_phone_number: string;
        phone_number_id: string;
      };
      contacts?: Array<{ profile: { name: string }; wa_id: string }>;
      messages?: WebhookMessage[];
      statuses?: WebhookStatus[];
      errors?: Array<{ code: number; title: string; message: string }>;
    };
  }>;
}

/** Referral em mensagens vindas de anúncios Click-to-WhatsApp / Meta (campos variam por produto). */
export interface WebhookReferral {
  source_url?: string;
  source_type?: string;
  source_id?: string;
  headline?: string;
  body?: string;
  ctwa_clid?: string;
  welcome_message?: { text?: string };
  [key: string]: unknown;
}

export interface WebhookMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  audio?: { id: string };
  video?: { id: string };
  document?: { id: string; filename?: string };
  referral?: WebhookReferral;
}

export interface WebhookStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
}

export interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}
