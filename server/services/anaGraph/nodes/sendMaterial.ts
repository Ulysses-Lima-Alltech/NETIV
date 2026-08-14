import {
  userExplicitlyAskedForMaterial,
  isFollowupMaterialCommand,
  inferPreferredCategoryFromUserText,
  buildDocCategoryTryOrder,
} from '../../../utils/anaDocSendIntent.js';
import {
  pickMaterialUnavailableNeutralReply,
  pickMaterialSendFailedNeutralReply,
} from '../../../utils/anaMaterialReply.js';
import { listEnterpriseFiles } from '../../../repositories/enterpriseRepository.js';
import type { FileCategory } from '../../../repositories/enterpriseRepository.js';
import type { AnaGraphState } from '../state.js';

type EnterpriseFileRow = Awaited<ReturnType<typeof listEnterpriseFiles>>[number];

/**
 * Envio real é sempre injetável — nunca chamado direto hardcoded a partir do
 * grafo novo. Em modo sombra (fase 9) o chamador DEVE passar um mock aqui.
 * TODO(fase 8/9): a resolução de storage_path -> caminho de arquivo local/S3
 * hoje só existe embutida em conversationEngine.ts (não exportada); esta
 * função injetável recebe a linha do arquivo e decide como resolvê-lo.
 */
export type SendMaterialFn = (params: {
  conversationId: number;
  to: string;
  file: EnterpriseFileRow;
}) => Promise<{ sent: boolean }>;

export interface SendMaterialNodeParams {
  conversationId: number;
  enterpriseId: number | null;
  customerPhone: string;
  llmSuggestedCategory?: FileCategory | null;
  sendMaterial: SendMaterialFn;
}

export async function sendMaterialNode(
  state: AnaGraphState,
  params: SendMaterialNodeParams
): Promise<Partial<AnaGraphState>> {
  const explicit = userExplicitlyAskedForMaterial(state.userMessage);
  const isFollowup = isFollowupMaterialCommand(state.userMessage);
  if (!explicit.explicit && !isFollowup) {
    return { assistantReplyText: null };
  }

  if (params.enterpriseId == null) {
    return { assistantReplyText: pickMaterialUnavailableNeutralReply(state.commercialFlowState.lastAssistantSnippet) };
  }

  const files = await listEnterpriseFiles(params.enterpriseId);
  const sendableCategories = Array.from(
    new Set(files.filter((f) => f.is_active && f.can_be_sent_by_ana).map((f) => f.category as FileCategory))
  );
  const userHintCategory = inferPreferredCategoryFromUserText(state.userMessage);
  const tryOrder = buildDocCategoryTryOrder(
    params.llmSuggestedCategory ?? null,
    userHintCategory,
    sendableCategories
  );

  const chosenCategory = tryOrder[0] ?? null;
  const chosenFile = chosenCategory
    ? files.find((f) => f.is_active && f.can_be_sent_by_ana && f.category === chosenCategory)
    : null;

  if (!chosenFile) {
    return {
      assistantReplyText: pickMaterialUnavailableNeutralReply(state.commercialFlowState.lastAssistantSnippet),
      commercialFlowState: {
        ...state.commercialFlowState,
        last_material_send_status: 'not_found',
      },
    };
  }

  const result = await params.sendMaterial({
    conversationId: params.conversationId,
    to: params.customerPhone,
    file: chosenFile,
  });

  if (!result.sent) {
    return {
      assistantReplyText: pickMaterialSendFailedNeutralReply(state.commercialFlowState.lastAssistantSnippet),
      commercialFlowState: {
        ...state.commercialFlowState,
        last_material_send_status: 'send_failed',
      },
    };
  }

  return {
    assistantReplyText: null,
    replyIntentionallyEmpty: true,
    commercialFlowState: {
      ...state.commercialFlowState,
      last_material_sent_id: chosenFile.id,
      last_material_send_status: 'sent',
      last_requested_material_type: chosenCategory,
      last_material_request_at: new Date().toISOString(),
    },
  };
}
