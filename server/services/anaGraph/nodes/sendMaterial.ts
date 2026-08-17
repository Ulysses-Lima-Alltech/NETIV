import {
  userExplicitlyAskedForMaterial,
  isFollowupMaterialCommand,
  inferPreferredCategoryFromUserText,
  buildDocCategoryTryOrder,
  extractAnaImageFilenameTopic,
  extractAnaSpecificMediaSpace,
  filterAnaImageFilesByFilenameTopic,
  filterAnaMediaFilesBySpecificSpace,
} from '../../../utils/anaDocSendIntent.js';
import {
  pickMaterialUnavailableNeutralReply,
  pickMaterialSendFailedNeutralReply,
} from '../../../utils/anaMaterialReply.js';
import {
  listEnterpriseFiles,
  getFileForSend,
  resolveSendableEnterpriseImageFilesCurrentVersion,
  type ResolvedSendableEnterpriseFile,
} from '../../../repositories/enterpriseRepository.js';
import type { FileCategory } from '../../../repositories/enterpriseRepository.js';
import type { AnaGraphState } from '../state.js';

/**
 * Envio real é sempre injetável — nunca chamado direto hardcoded a partir do
 * grafo novo. Em modo sombra (fase 9) o chamador DEVE passar um mock aqui.
 * `file` já vem totalmente resolvido (path/originalName/mime) por este nó —
 * o dep de envio (productionDeps.ts) só manda o arquivo exato recebido, sem
 * re-resolver por categoria (bug anterior: re-resolver por categoria sempre
 * devolvia "o" arquivo atual daquela categoria, ignorando qual foto
 * específica tinha sido escolhida — cliente pedia foto da piscina e recebia
 * sempre a mesma foto de academia).
 */
export type SendMaterialFn = (params: {
  conversationId: number;
  enterpriseId: number;
  to: string;
  file: ResolvedSendableEnterpriseFile;
}) => Promise<{ sent: boolean }>;

export interface SendMaterialNodeParams {
  conversationId: number;
  enterpriseId: number | null;
  customerPhone: string;
  llmSuggestedCategory?: FileCategory | null;
  sendMaterial: SendMaterialFn;
}

/**
 * Categorias com várias instâncias por empreendimento (várias fotos/vídeos,
 * cada um de um espaço diferente) — precisam resolução por título de
 * arquivo, não só por categoria. Categorias de instância única (book,
 * unidades, tabela_comercial) continuam resolvidas por getFileForSend
 * (mesma função que o motor legado usa).
 */
const MULTI_INSTANCE_CATEGORIES = new Set<FileCategory>(['foto', 'video']);

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

  let chosenFile: ResolvedSendableEnterpriseFile | null = null;
  if (chosenCategory && MULTI_INSTANCE_CATEGORIES.has(chosenCategory)) {
    // Resolve por título/nome de arquivo (mesmo módulo que o motor legado usa
    // antes de enviar imagem — ver conversationEngine.ts, extractAnaImageFilenameTopic
    // / extractAnaSpecificMediaSpace) pra mandar a foto certa do espaço pedido
    // (piscina, academia, fireplace etc.), não sempre a primeira da categoria.
    const candidates = await resolveSendableEnterpriseImageFilesCurrentVersion(params.enterpriseId, 30);
    const byCategory = candidates.filter((f) => f.category === chosenCategory);
    const requestedSpace = extractAnaSpecificMediaSpace(state.userMessage);
    const requestedTopic = extractAnaImageFilenameTopic(state.userMessage);
    const filtered = requestedSpace
      ? filterAnaMediaFilesBySpecificSpace(byCategory, requestedSpace)
      : requestedTopic
        ? filterAnaImageFilesByFilenameTopic(byCategory, requestedTopic)
        : byCategory;
    chosenFile = filtered[0] ?? byCategory[0] ?? null;
  } else if (chosenCategory) {
    chosenFile = await getFileForSend(params.enterpriseId, chosenCategory);
  }

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
    enterpriseId: params.enterpriseId,
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
