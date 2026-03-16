import { z } from 'zod';

export const whatsappSettingUpdateSchema = z.object({
  metaAccessToken: z.string().optional(),
  whatsappPhoneNumberId: z.string().optional(),
  whatsappBusinessAccountId: z.string().optional(),
  apiVersion: z.string().optional(),
  webhookVerifyToken: z.string().optional(),
  defaultSendPhoneNumber: z.string().nullable().optional(),
  defaultCountryCode: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export type WhatsAppSettingUpdateDto = z.infer<typeof whatsappSettingUpdateSchema>;
