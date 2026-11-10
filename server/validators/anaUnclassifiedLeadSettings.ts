import { z } from 'zod';

export const unclassifiedLeadSettingsSchema = z.object({
  initialMessage: z.string().max(2000).nullable(),
  followUpMessage: z.string().max(2000).nullable().optional(),
}).strict();

export const unclassifiedLeadFollowupPreviewSchema = z.object({
  templateKey: z.string().trim().min(1).max(200),
}).strict();

export const unclassifiedLeadFollowupSendSchema = z.object({
  requestId: z.string().uuid(),
  templateKey: z.string().trim().min(1).max(200),
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
  consentConfirmed: z.literal(true),
}).strict();
