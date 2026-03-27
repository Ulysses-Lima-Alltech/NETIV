import type { EnterpriseRow, EnterpriseTipo } from '../repositories/enterpriseRepository.js';
import type { RequestedProductType } from '../utils/anaRequestedProductType.js';
import type { LocationQueryContext } from '../utils/anaEnterpriseLocationContext.js';
import { parseAddons, normalizeFileCategory, type FileCategory } from '../repositories/enterpriseRepository.js';
import { buildCatalogListMessage } from '../utils/anaCatalogMessages.js';
import type { AppointmentPreflight } from '../utils/anaAppointmentIntent.js';
export type { AppointmentPreflight } from '../utils/anaAppointmentIntent.js';

/** Variáveis comerciais por empreendimento (preço, condições, disponibilidade) para o prompt. */
export interface CommercialSnapshot {
  enterpriseName: string;
  variables: Record<string, string>;
}

export interface AnaStructuredReply {
  reply: string;
  classification: string;
  /** null = não atualizar temperatura no banco nesta rodada (não inventar "frio"). */
  lead_temperature: string | null;
  project: string;
  handoff: boolean;
  customer_name: string;
  summary: string;
  /** Se o cliente pediu material (ex.: book) e existe arquivo nesta categoria neste empreendimento. */
  send_file_category: FileCategory | null;
  /** Agendamento explícito confirmado no diálogo (data/hora combinadas). */
  appointment_confirmed?: boolean;
  appointment_date?: string | null;
  appointment_time?: string | null;
  appointment_notes?: string | null;
  /** Interpretação estruturada (obrigatória no JSON do modelo). */
  intent?: string;
  productType?: string | null;
  wantsCatalog?: boolean;
  locationPreference?: string | null;
  budgetPreference?: string | null;
  bedroomsPreference?: string | null;
  bathroomsPreference?: string | null;
  nextBestQuestion?: string | null;
  userGoal?: string | null;
  lotSizePreference?: string | null;
  shouldShowPortfolio?: boolean;
}

/** Resposta quando o JSON da IA falha ou a chamada não retorna conteúdo válido (backend). */
export const ANA_FALLBACK_INCOMPREHENSION_REPLY =
  'Me conta em uma linha o que você busca que eu te ajudo a direcionar.';

/** Fallback técnico mínimo quando a API falha ou a resposta é inválida — sem catálogo nem menu. */
export const ANA_TECHNICAL_FALLBACK_NEUTRAL =
  'Não consegui continuar daqui agora. Me manda novamente em uma frase o que você quer saber.';

/**
 * Próximo passo único quando há sinais de busca mas o modelo falhou (substitui variantes antigas por produto).
 * Mantém o nome exportado para compatibilidade com imports existentes.
 */
export const ANA_FALLBACK_REFINEMENT_CONTEXT_REPLY =
  'Me diz a região ou o que você quer priorizar agora (faixa, tamanho, perfil) que eu sigo com você.';

/** Triagem: tipo ainda não inferido no backend — não há lista mista para mostrar. */
export const ANA_FALLBACK_ASK_PRODUCT_TYPE =
  'Pra eu te mostrar certinho: você quer loteamento, apartamento ou linha MCMV?';

/** Detecta pedido explícito de catálogo/portfólio OU sinal de que o cliente não consegue/quer filtrar antes de ver. */
export function hasCatalogIntent(ctx: string): boolean {
  if (/\b(me\s+mostr|quero\s+ver|quais\s+opcoes|quais\s+empreendimentos|o\s+que\s+voces?\s+te[mn]|o\s+que\s+voces?\s+trabalha|me\s+mostra\s+tudo|quero\s+conhecer|quero\s+saber\s+quais|mostra\s+as\s+opcoes|me\s+passa\s+as\s+opcoes|lista|catalogo|portfolio)\b/.test(ctx)) return true;
  if (/\b(nao\s+sei|não\s+sei|nao\s+tenho\s+prefer|não\s+tenho\s+prefer|qualquer\s+regiao|qualquer\s+região|tanto\s+faz|sem\s+preferencia|sem\s+preferência|mostra\s+tudo|ver\s+tudo|quero\s+tudo|me\s+mostra\s+o\s+que\s+tem)\b/.test(ctx)) return true;
  return false;
}

/**
 * Fallback com lista real de nomes do portfólio — usado quando o cliente pede explicitamente catálogo
 * e a reply da LLM falhou no parse ou caiu em fallback genérico.
 */
export function buildCatalogFallbackReply(
  allEnterpriseNames: string[],
  recentContext?: string,
  productTypeHint?: RequestedProductType
): string {
  return buildCatalogListMessage(allEnterpriseNames, {
    productTypeHint,
    recentContext,
  });
}

/** Fallback de refinamento sensível ao tipo de produto inferido no contexto recente. */
export function buildRefinementContextReply(
  recentContext?: string,
  allEnterpriseNames?: string[],
  productTypeHint?: RequestedProductType
): string {
  const ctx = (recentContext || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (hasCatalogIntent(ctx)) {
    if (allEnterpriseNames && allEnterpriseNames.length > 0) {
      return buildCatalogFallbackReply(allEnterpriseNames, recentContext, productTypeHint);
    }
    if (productTypeHint === 'INDEFINIDO' || productTypeHint == null) {
      return ANA_FALLBACK_ASK_PRODUCT_TYPE;
    }
    return buildCatalogFallbackReply([], recentContext, productTypeHint);
  }
  if (/\b(lote|lotes|loteamento|terreno|terrenos|loteamentos)\b/.test(ctx)) {
    if (allEnterpriseNames && allEnterpriseNames.length > 0) {
      return buildCatalogFallbackReply(allEnterpriseNames, recentContext, productTypeHint ?? 'LOTEAMENTO');
    }
    return ANA_FALLBACK_REFINEMENT_CONTEXT_REPLY;
  }
  return ANA_FALLBACK_REFINEMENT_CONTEXT_REPLY;
}

const JSON_INSTRUCTION = `
JSON: um único objeto JSON válido (RFC 8259), sem markdown, sem texto antes ou depois, sem comentários e sem vírgula sobrando.

Schema:
{
  "intent": "qualificar | agendar | pedir_material | comparar | duvida",
  "productType": null | "LOTEAMENTO" | "APARTAMENTO" | "MCMV" | "INDEFINIDO",
  "wantsCatalog": false,
  "shouldShowPortfolio": false,
  "locationPreference": null,
  "budgetPreference": null,
  "bedroomsPreference": null,
  "bathroomsPreference": null,
  "userGoal": null,
  "lotSizePreference": null,
  "nextBestQuestion": null,
  "reply": "WhatsApp texto puro; vários empreendimentos: 📍 e só linhas 💰📄📐📝 com valor real",
  "classification": "Novo" | "Qualificado" | "Carteira" | "Handoff",
  "lead_temperature": "frio" | "morno" | "quente" (OMITA a chave se não houver inferência nova),
  "project": "",
  "handoff": false,
  "customer_name": "",
  "summary": "",
  "send_file_category": null | "book" | "unidades" | "tabela_comercial" | "outro",
  "appointment_confirmed": false,
  "appointment_date": null,
  "appointment_time": null,
  "appointment_notes": null
}

Obrigatório no objeto: "reply" (string não vazia), "classification" (string), "handoff" (boolean). Demais chaves: tipos conforme schema; booleanos como true/false JSON, nunca string.

reply — regras curtas:
- Localização, m², preço, pedido de opções → resposta comercial útil, nunca "não entendi".
- Lista de empreendimentos no reply: você só pode listar opções se o cliente pedir explicitamente para ver opções, comparar opções ou conhecer o portfólio (wantsCatalog + shouldShowPortfolio true; nomes só os que o prompt listar, 📍, máx. 5). Se já existir um empreendimento em foco, aprofunde esse foco e não reabra a lista por iniciativa própria.
- productType alinhado ao filtro que o backend já aplicou.
- Não invente dado comercial; lacunas: omita ou diga que não consta no que você tem.

appointment_*: confirmed só com data+hora combinadas de verdade; use histórico para completar; remarcação atualiza date/time.

send_file_category: preencha se o cliente pedir e a categoria existir na lista do empreendimento; senão null e não prometa arquivo.

lead_temperature: separado de handoff; compra/fechamento explícito → "quente"; nunca envie null para apagar temperatura.`;

const COMPORTAMENTO = `
Você é Ana.

Seu papel é conduzir conversas comerciais de forma natural, objetiva, cordial e humana, ajudando o cliente a avançar na decisão sem parecer menu automático.

IDENTIDADE E TOM
- Apresente-se apenas como Ana.
- Não diga que é assistente virtual, IA, robô ou sistema, a menos que isso seja exigido explicitamente.
- Fale como um atendimento comercial humano, com linguagem simples, clara e direta.
- Seja prestativa, natural e segura, sem soar engessada.
- Evite textos longos demais.
- Evite repetir frases e estruturas.

COMO CONDUZIR A CONVERSA
- Sempre considere o contexto recente antes de responder.
- Trate mensagens curtas como continuação do assunto atual sempre que houver contexto suficiente.
- Se o cliente já escolheu um empreendimento, mantenha o foco nele até surgir motivo real para ampliar a conversa.
- Você só pode listar opções de empreendimentos se o cliente pedir explicitamente para ver opções, comparar opções ou conhecer o portfólio. Se já existir um empreendimento em foco, aprofunde esse foco e não reabra a lista por iniciativa própria.
- Não apresente novamente a lista de empreendimentos a menos que o cliente peça opções, comparação entre opções ou portfólio.
- Não volte a listar opções se o cliente já demonstrou foco em um empreendimento.
- Priorize aprofundar o que o cliente pediu, em vez de abrir várias frentes ao mesmo tempo.
- Depois de responder, conduza o próximo passo com uma pergunta curta e útil.

SOBRE EMPREENDIMENTOS E INFORMAÇÕES
- Você só pode listar opções de empreendimentos se o cliente pedir explicitamente para ver opções, comparar opções ou conhecer o portfólio; caso contrário, não despeje lista por conta própria.
- Se já existir um empreendimento em foco (no histórico ou nos dados do contexto), aprofunde esse foco e não reabra a lista por iniciativa própria.
- Você pode comparar empreendimentos quando o cliente pedir explicitamente.
- Você pode aprofundar temas como lazer, localização, valor, metragem, infraestrutura, segurança, perfil de uso e condição comercial, quando houver base para isso.
- Nunca invente dados.
- Nunca afirme preço, disponibilidade, prazo, metragem, documentação, aprovação ou benefício sem base nas informações fornecidas.
- Se faltar informação, diga isso de forma elegante e leve a conversa para o próximo passo útil.

QUANDO O CLIENTE MANDA MENSAGENS CURTAS
Exemplos: "lazer", "valor", "localização", "metragem", "gostei", "esse", "sim", "quero".
- Se o cliente disser apenas isso (ou variações curtas no mesmo sentido), trate como continuidade do foco atual no histórico.
- Interprete como continuação do contexto atual, se houver.
- Não reinicie a conversa.
- Não volte ao catálogo.
- Não responda como menu.

QUANDO FALTAR CONTEXTO
- Se realmente não der para identificar o foco, faça uma pergunta curta de esclarecimento.
- Pergunte de forma natural.
- Não use tom burocrático.
- Não peça para o cliente repetir tudo.
- Não faça múltiplas perguntas de uma vez.

QUANDO O CLIENTE ESTIVER INDECISO
- Ajude a comparar de forma simples.
- Destaque diferenças práticas.
- Direcione a conversa para entender perfil, prioridade e objetivo de compra.
- Não despeje informação demais de uma vez.

QUANDO HOUVER OBJEÇÃO
- Responda com empatia e objetividade.
- Não pressione.
- Não discuta.
- Tente manter a conversa avançando com suavidade.

O QUE EVITAR
- Não soar como chatbot de menu.
- Não repetir lista de opções sem necessidade.
- Não responder ignorando o contexto.
- Não inventar fatos.
- Não usar linguagem excessivamente promocional.
- Não ser agressiva.
- Não escrever respostas excessivamente longas.
- Não mudar de assunto sem motivo.

FORMATO DE RESPOSTA
- Respostas curtas ou médias.
- Um foco por vez.
- Clareza primeiro.
- Quando fizer sentido, termine com uma pergunta útil para continuar o atendimento.

DESPEDIDA
Se o cliente encerrar, agradeça sem forçar pergunta final.

HANDOFF E SAÍDA ESTRUTURADA
Handoff só com pedido explícito de humano ou caso fora do cadastro. Preencha o JSON conforme o schema abaixo; o campo "reply" é a única mensagem enviada ao cliente no WhatsApp.

Ordem de leitura dos dados: variáveis cadastradas → trechos indexados → arquivos; em dúvida sobre preço ou condições, priorize as variáveis.
${JSON_INSTRUCTION}`;

const LANGUAGE_HINT: Record<string, string> = {
  informal: 'Tom informal BR.',
  natural: 'Tom natural.',
  formal: 'Tom formal.',
  culta: 'Tom culto.',
};

/** Linhas de variáveis no padrão visual WhatsApp (referência para a Ana replicar ao responder). */
function formatVars(v: Record<string, string>): string {
  return [
    `💰 Preço: ${v.preco?.trim() || '[não informado]'}`,
    `📄 Condições: ${v.condicoes?.trim() || '[não informado]'}`,
    `📐 Disponibilidade: ${v.disponibilidade?.trim() || '[não informado]'}`,
    `📝 Observações: ${v.observacoes?.trim() || '[nenhuma]'}`,
  ].join('\n');
}

/** Aberturas variadas (sorteio no servidor quando há 2+ empreendimentos com dados). */
export const COMMERCIAL_LIST_OPENINGS: string[] = [
  'Tenho essas opções pra você:',
  'Olha as opções que temos:',
  'Essas são as opções disponíveis:',
  'Seguem as opções:',
  'Vou te passar as opções:',
];

/** Fechamentos consultivos (sorteio independente da abertura). */
export const COMMERCIAL_LIST_CLOSINGS: string[] = [
  'Algum desses te chamou mais atenção?',
  'Quer que eu te explique melhor algum deles?',
  'Qual deles faz mais sentido pra você?',
  'Quer que eu detalhe algum deles pra você?',
  'Quer comparar duas opções com calma?',
];

export function pickCommercialListUx(): { opening: string; closing: string } {
  const oi = Math.floor(Math.random() * COMMERCIAL_LIST_OPENINGS.length);
  const ci = Math.floor(Math.random() * COMMERCIAL_LIST_CLOSINGS.length);
  return {
    opening: COMMERCIAL_LIST_OPENINGS[oi]!,
    closing: COMMERCIAL_LIST_CLOSINGS[ci]!,
  };
}

function buildCommercialListUxBlock(h: { opening: string; closing: string }): string {
  return `

UX — LISTAGEM COMERCIAL (mais de um empreendimento nesta rodada — siga para a resposta ao cliente):
- Abra com tom natural de secretária comercial. Base (pode ajustar levemente uma palavra, sem mudar o sentido): "${h.opening}"
- Depois da abertura, uma linha em branco e então o primeiro 📍.
- Entre um bloco e outro: após o último campo de um empreendimento, uma linha em branco e só então o próximo 📍. Não use duas ou mais linhas em branco seguidas.
- Ao final do último bloco, uma linha em branco e feche com pergunta consultiva; nesta rodada prefira: "${h.closing}"
- Se houver mais de dois empreendimentos e o fechamento citar "dois", adapte para plural de forma natural (ex.: "comparar essas opções").`;
}

function buildCommercialDataBlock(snapshots: CommercialSnapshot[]): string {
  if (snapshots.length === 0) return '';
  const body = snapshots
    .map((s) => `📍 ${s.enterpriseName}\n${formatVars(s.variables)}`)
    .join('\n\n');
  return `

DADOS COMERCIAIS CADASTRADOS NO SISTEMA (fonte primária — use antes de supor ou dizer que não tem acesso):
${body}

Regras: use só linhas com valor real (omitir "[não informado]" / "[nenhuma]"). 📍 + 💰📄📐📝 conforme cadastro. Sem inventar. Vários empreendimentos: um bloco 📍 por linha, separados por uma linha em branco.`;
}

const CLASS_OK = new Set(['Novo', 'Qualificado', 'Carteira', 'Handoff']);
const TEMP_OK = new Set(['frio', 'morno', 'quente']);

/** Frases normalizadas (sem acento) para elevar temperatura a quente quando o modelo omitir ou subestimar. */
const STRONG_PURCHASE_INTENT_PATTERNS: string[] = [
  'quero comprar agora',
  'quero comprar',
  'vou comprar',
  'comprar agora',
  'quero fechar',
  'vamos fechar',
  'fechar o negocio',
  'fechar negocio',
  'fechar hoje',
  'quero dar andamento',
  'dar andamento',
  'quero avancar',
  'vamos seguir',
  'vamos avancar',
  'quero reservar',
  'fazer reserva',
  'quero dar entrada',
  'dar entrada',
  'quero agendar',
  'agendar visita',
  'me passa a documentacao',
  'me passa documentacao',
  'passe a documentacao',
  'passa a documentacao',
  'manda a documentacao',
  'envia a documentacao',
  'documentacao para comprar',
  'como faco para comprar',
  'como comprar',
  'como funciona para comprar',
  'quero formalizar',
  'formalizar a compra',
  'assinatura do contrato',
  'assinar o contrato',
];

function normLeadIntentText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Garantia de backend: intenção explícita de compra/fechamento → pelo menos quente no merge. */
export function detectStrongPurchaseIntentForLeadTemperature(message: string): boolean {
  const n = normLeadIntentText(message);
  if (!n) return false;
  return STRONG_PURCHASE_INTENT_PATTERNS.some((p) => n.includes(p));
}

/** Aceita string, array de strings (modelo às vezes devolve ["book"]) e busca em objetos aninhados comuns. */
function coerceSendFileCategoryRaw(raw: unknown, depth = 3): string | null {
  if (depth < 0 || raw === undefined || raw === null) return null;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const s = coerceSendFileCategoryRaw(x, depth - 1);
      if (s) return s;
    }
    return null;
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const direct =
      o.send_file_category ??
      o.sendFileCategory ??
      o.file_category ??
      o.fileCategory ??
      o.categoria_arquivo;
    const fromDirect = coerceSendFileCategoryRaw(direct, depth - 1);
    if (fromDirect) return fromDirect;
    for (const nest of ['structured', 'data', 'payload', 'result'] as const) {
      const inner = o[nest];
      if (inner && typeof inner === 'object') {
        const nested = coerceSendFileCategoryRaw(inner, depth - 1);
        if (nested) return nested;
      }
    }
  }
  return null;
}

export interface BuildAnaSystemPromptOpts {
  mode: 'triage' | 'scoped' | 'inactive_linked';
  enterprise: EnterpriseRow | null;
  variablesMap: Record<string, string>;
  knowledgeText: string;
  /** Só arquivos com permissão de envio; se vazio, a Ana não deve pedir send_file_category. */
  fileInventory: string;
  allEnterpriseNames?: string[];
  /** Nome já conhecido do cliente (para contagem de menções). */
  knownCustomerName?: string | null;
  /** Quantas vezes a Ana já mencionou o nome do cliente nas respostas anteriores. */
  customerNameMentionsSoFar?: number;
  /** Classificação atual da conversa no banco (referência para triagem). */
  conversationClassification?: string | null;
  /** Pré-detecção na engine: fluxo de agendamento (prioridade sobre triagem genérica). */
  appointmentPreflight?: AppointmentPreflight | null;
  /** Resumo do agendamento aberto (mesma conversa + empreendimento), se existir. */
  openAppointmentSummary?: string | null;
  /**
   * Consulta por cidade/região: subset real do banco. Em triagem, `allEnterpriseNames` já vem filtrado.
   * Em modo com empreendimento focado, o JSON ainda obriga a usar só essa lista ao falar da localidade perguntada.
   */
  locationQueryContext?: LocationQueryContext | null;
  /** Por empreendimento: preço, condições, disponibilidade (triagem com localização ou foco único). */
  commercialSnapshots?: CommercialSnapshot[] | null;
  /** @deprecated não usado no prompt unificado */
  commercialListUxHints?: { opening: string; closing: string } | null;
  /**
   * Tipo validado no backend (triagem: inferência + filtro de lista; scoped: tipo do empreendimento em foco).
   * Usado para alinhar o prompt com a lista já filtrada — a IA não decide o tipo sozinha.
   */
  requestedProductType?: RequestedProductType | null;
  /** @deprecated — mantido por compatibilidade de tipo; ignorado no prompt unificado */
  conversationPhase?:
    | 'appointment'
    | 'scoped'
    | 'inactive'
    | 'triage_ask_type'
    | 'triage_catalog'
    | 'triage_location'
    | 'triage';
  /** Contexto persistido (IDs, JSON de estado) — só orientação; a Ana redige a resposta. */
  persistedContextBlock?: string | null;
}

/** Dados de apoio para pergunta de localização (sem impor “fases” de motor). */
function buildLocationHintForPrompt(loc: LocationQueryContext): string {
  const payload = JSON.stringify({ availableEnterprises: loc.availableEnterprises }, null, 0);
  const emptyRule = loc.isEmpty
    ? 'Lista vazia no cadastro para essa localidade: informe sem inventar nomes.'
    : 'Há empreendimentos nesta lista para esta consulta.';
  return `--- Referência de localização (quando a mensagem for sobre cidade/região) ---
Mencionado pelo cliente: "${loc.userMentionLabel}".
${payload}
${emptyRule}`;
}

function buildUnifiedAppointmentHint(ap: AppointmentPreflight | null | undefined): string {
  if (!ap?.active) return '';
  return `AGENDAMENTO (dica do sistema): o cliente pode estar combinando ou alterando visita/data/hora. Leia o histórico; mensagens curtas podem ser continuação.
${ap.reschedule ? '- Remarcação: atualize sem recomeçar do zero.\n' : ''}${ap.dateContestation ? '- Contestação de data: calendário Brasil.\n' : ''}${ap.continuationOnly ? '- Possível complemento só de data/hora.\n' : ''}`;
}

/** Prompt único: só a OpenAI redige a resposta; o backend só junta dados e contexto. */
export function buildAnaSystemPrompt(opts: BuildAnaSystemPromptOpts): string {
  const base = COMPORTAMENTO;
  const loc = opts.locationQueryContext ?? null;
  const locationHint = loc ? buildLocationHintForPrompt(loc) : '';
  const commercialBlock = buildCommercialDataBlock(opts.commercialSnapshots ?? []);
  const persisted = (opts.persistedContextBlock || '').trim()
    ? `--- CONTEXTO PERSISTIDO (continuidade; não copie texto técnico ao cliente) ---\n${opts.persistedContextBlock}\n\n`
    : '';

  const triageType = opts.requestedProductType ?? 'INDEFINIDO';
  const namesList =
    loc?.isEmpty && (opts.allEnterpriseNames?.length ?? 0) === 0
      ? '(nenhum empreendimento ativo no banco para esta localidade)'
      : (opts.allEnterpriseNames?.length ?? 0) > 0
        ? opts.allEnterpriseNames!.join(', ')
        : triageType === 'INDEFINIDO'
          ? '(defina tipo com o cliente antes de inventar nomes)'
          : `(nenhum empreendimento do tipo ${triageType} no filtro atual)`;

  const cls = (opts.conversationClassification || 'Novo').trim();
  const ap = opts.appointmentPreflight;
  const openCtx = (opts.openAppointmentSummary || '').trim()
    ? `AGENDAMENTO NO SISTEMA:\n${(opts.openAppointmentSummary || '').trim()}\n\n`
    : '';
  const appointmentHint = buildUnifiedAppointmentHint(ap);

  if (opts.mode === 'inactive_linked') {
    return `${base}

${persisted}--- EMPREENDIMENTO VINCULADO INATIVO ---
O cadastro associado a esta conversa não está ativo. Informe com cordialidade; não invente dados. send_file_category: null.`;
  }

  const know = opts.knowledgeText.trim()
    ? `\n--- Base de conhecimento (trechos + arquivos) ---\n${opts.knowledgeText.slice(0, 52_000)}`
    : '';

  if (opts.mode === 'triage' || !opts.enterprise) {
    return `${base}

${persisted}${locationHint ? `${locationHint}\n\n` : ''}${commercialBlock ? `${commercialBlock}\n\n` : ''}PORTFÓLIO (nomes permitidos neste contexto — tipo de interesse: ${triageType}): ${namesList}
Classificação (referência): "${cls}".
${openCtx}${appointmentHint}
- Você conduz a conversa; use o histórico e os dados acima.`;
  }

  const e = opts.enterprise!;
  const addons = parseAddons(e.prompt_addons);
  const addonsBlock = addons.length ? `\nExtras:\n${addons.map((a) => `- ${a}`).join('\n')}` : '';
  const inv = opts.fileInventory.trim() || '(nenhum arquivo cadastrado)';
  const allowMat = (opts.fileInventory?.trim() || '') !== '';
  const matBlock = allowMat
    ? `Arquivos que podem ser enviados (por categoria):\n${inv}\nMapeamento: book | unidades | tabela_comercial | outro.\n`
    : `Envio de arquivos por aqui desativado — send_file_category sempre null.\n`;

  const nm = (opts.knownCustomerName || '').trim();
  const mentions = opts.customerNameMentionsSoFar ?? 0;
  const nameHint =
    nm.length >= 2
      ? `Nome do cliente: "${nm}" (menções aproximadas nas suas respostas: ${mentions}).`
      : 'Nome do cliente ainda não identificado — pergunte com naturalidade quando fizer sentido.';

  const openScoped = (opts.openAppointmentSummary || '').trim()
    ? `AGENDAMENTO EM ANDAMENTO:\n${(opts.openAppointmentSummary || '').trim()}\n\n`
    : '';
  const appointmentScoped =
    ap?.active === true
      ? `AGENDAMENTO: prioridade sobre novo catálogo; leia o histórico.
${ap.reschedule ? '- Remarcação.\n' : ''}${ap.dateContestation ? '- Contestação de data (Brasil).\n' : ''}\n`
      : '';

  return `${base}

${persisted}${locationHint ? `${locationHint}\n\n` : ''}${commercialBlock ? `${commercialBlock}\n\n` : ''}--- FOCO DO CADASTRO ATUAL ---
Empreendimento: "${e.name}" (${e.tipo}).
${nameHint}
${openScoped}${appointmentScoped}
${matBlock}
📍 ${e.name}
${formatVars(opts.variablesMap)}

Outros nomes no mesmo universo (troca só se o cliente pedir ou citar outro): ${namesList}
Preencha "project" no JSON com o nome exato do empreendimento quando o foco mudar para outro cadastrado.

${LANGUAGE_HINT[e.language_style] || LANGUAGE_HINT.natural}

${addonsBlock}
${know}`;
}

function stripModelMarkdownFence(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  return s;
}

function extractFirstJsonObjectSlice(raw: string): string | null {
  const t = raw.trim();
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

function tryParseStrictJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = stripModelMarkdownFence(raw).trim();
  const candidates: string[] = [s];
  const sliced = extractFirstJsonObjectSlice(s);
  if (sliced && sliced !== s) candidates.push(sliced);
  for (const c of candidates) {
    try {
      const v = JSON.parse(c) as unknown;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // apenas JSON estrito (sem correção heurística)
    }
  }
  return null;
}

function strictOptionalBoolean(o: Record<string, unknown>, key: string): boolean {
  if (!(key in o)) return true;
  return typeof o[key] === 'boolean';
}

/** Validação de schema esperado; retorna código de erro ou null se ok. */
function validateStrictAnaShape(o: Record<string, unknown>): string | null {
  if (typeof o.reply !== 'string' || !o.reply.trim()) return 'reply';
  if (typeof o.handoff !== 'boolean') return 'handoff';
  if (typeof o.classification !== 'string' || !o.classification.trim()) return 'classification';
  if (!strictOptionalBoolean(o, 'appointment_confirmed')) return 'appointment_confirmed_type';
  if (!strictOptionalBoolean(o, 'wantsCatalog')) return 'wantsCatalog_type';
  if (!strictOptionalBoolean(o, 'shouldShowPortfolio')) return 'shouldShowPortfolio_type';
  if (o.project != null && typeof o.project !== 'string') return 'project_type';
  if (o.customer_name != null && typeof o.customer_name !== 'string') return 'customer_name_type';
  if (o.summary != null && typeof o.summary !== 'string') return 'summary_type';
  if (o.intent != null && typeof o.intent !== 'string') return 'intent_type';
  const rawLt = o.lead_temperature ?? (o as Record<string, unknown>).leadTemperature;
  if (rawLt != null && typeof rawLt !== 'string') return 'lead_temperature_type';
  const ptRaw = o.productType;
  if (ptRaw != null && ptRaw !== '' && coerceProductTypeRaw(ptRaw) === null) return 'productType_enum';
  const sc = coerceSendFileCategoryRaw(o);
  if (sc) {
    const norm = normalizeFileCategory(sc);
    if (!norm) return 'send_file_category_invalid';
  }
  return null;
}

function coerceProductTypeRaw(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim().toUpperCase();
  if (['LOTEAMENTO', 'APARTAMENTO', 'MCMV', 'INDEFINIDO'].includes(s)) return s;
  return null;
}

/**
 * Parse estrito: JSON válido (sem correção heurística) + tipos obrigatórios e enum permitido.
 * Qualquer falha → null (o engine usa fallback técnico neutro).
 */
export function parseAnaJson(raw: string): AnaStructuredReply | null {
  if (!raw || typeof raw !== 'string') return null;
  const preview = raw.trim().slice(0, 200);
  const o = tryParseStrictJsonObject(raw);
  if (!o) {
    console.warn('[DOC_PARSE] parse_failed_strict', { reason: 'json_parse', preview });
    return null;
  }
  const shapeErr = validateStrictAnaShape(o);
  if (shapeErr) {
    console.warn('[DOC_PARSE] parse_failed_strict', { reason: 'schema', field: shapeErr, preview });
    return null;
  }
  const reply = (o.reply as string).trim().slice(0, 4000);
  let classification = (o.classification as string).trim();
  if (classification === 'Interessado' || classification === 'Qualificando') classification = 'Qualificado';
  if (classification === 'Reserva') classification = 'Carteira';
  if (!CLASS_OK.has(classification)) {
    console.warn('[DOC_PARSE] parse_failed_strict', { reason: 'classification_enum', value: classification, preview });
    return null;
  }
  let lead_temperature: string | null = null;
  const rawLt = o.lead_temperature ?? (o as Record<string, unknown>).leadTemperature;
  if (typeof rawLt === 'string') {
    const lt = rawLt.trim().toLowerCase();
    lead_temperature = TEMP_OK.has(lt) ? lt : null;
  }
  let send_file_category: FileCategory | null = null;
  const sc = coerceSendFileCategoryRaw(o);
  if (sc) {
    const norm = normalizeFileCategory(sc);
    if (norm) send_file_category = norm;
  }
  const ac = o.appointment_confirmed ?? (o as Record<string, unknown>).appointmentConfirmed;
  const appointment_confirmed = ac === true;
  const appointment_date =
    typeof o.appointment_date === 'string'
      ? o.appointment_date.trim()
      : typeof (o as Record<string, unknown>).appointmentDate === 'string'
        ? String((o as Record<string, unknown>).appointmentDate).trim()
        : null;
  const appointment_time =
    typeof o.appointment_time === 'string'
      ? o.appointment_time.trim()
      : typeof (o as Record<string, unknown>).appointmentTime === 'string'
        ? String((o as Record<string, unknown>).appointmentTime).trim()
        : null;
  const appointment_notes =
    typeof o.appointment_notes === 'string'
      ? o.appointment_notes.trim()
      : typeof (o as Record<string, unknown>).appointmentNotes === 'string'
        ? String((o as Record<string, unknown>).appointmentNotes).trim()
        : null;
  const intent = typeof o.intent === 'string' ? o.intent.trim() : 'geral';
  const productType = coerceProductTypeRaw(o.productType);
  const wantsCatalog = o.wantsCatalog === true;
  const locationPreference =
    typeof o.locationPreference === 'string' ? o.locationPreference.trim() || null : null;
  const budgetPreference =
    typeof o.budgetPreference === 'string' ? o.budgetPreference.trim() || null : null;
  const bedroomsPreference =
    typeof o.bedroomsPreference === 'string' ? o.bedroomsPreference.trim() || null : null;
  const bathroomsPreference =
    typeof o.bathroomsPreference === 'string' ? o.bathroomsPreference.trim() || null : null;
  const nextBestQuestion =
    typeof o.nextBestQuestion === 'string' ? o.nextBestQuestion.trim() || null : null;
  const userGoal =
    typeof o.userGoal === 'string' ? o.userGoal.trim() || null : null;
  const lotSizePreference =
    typeof o.lotSizePreference === 'string' ? o.lotSizePreference.trim() || null : null;
  const shouldShowPortfolio = o.shouldShowPortfolio === true;
  console.log('[DOC_PARSE] structured ok (strict)', {
    send_file_category_raw: sc,
    send_file_category_norm: send_file_category,
    replyLen: reply.length,
    handoff: o.handoff,
    intent,
    productType,
  });
  return {
    reply,
    intent,
    productType,
    wantsCatalog,
    locationPreference,
    budgetPreference,
    bedroomsPreference,
    bathroomsPreference,
    nextBestQuestion,
    userGoal,
    lotSizePreference,
    shouldShowPortfolio,
    classification,
    lead_temperature,
    project: typeof o.project === 'string' ? o.project : '',
    handoff: o.handoff as boolean,
    customer_name: typeof o.customer_name === 'string' ? o.customer_name.trim() : '',
    summary: typeof o.summary === 'string' ? o.summary.trim() : '',
    send_file_category,
    appointment_confirmed,
    appointment_date: appointment_date || null,
    appointment_time: appointment_time || null,
    appointment_notes: appointment_notes || null,
  };
}

/** Export legado; não reaproveita texto bruto — só estrutura neutra (compatível com chamadas antigas). */
export function fallbackReplyFromRaw(
  _raw: string,
  _userMessage?: string,
  _knownCustomerName?: string | null,
  _appointmentFlow?: boolean,
  _appointmentContinuation?: boolean,
  _recentContextForHeuristic?: string,
  _allEnterpriseNames?: string[],
  _productTypeHint?: RequestedProductType
): AnaStructuredReply {
  return {
    reply: ANA_TECHNICAL_FALLBACK_NEUTRAL,
    intent: 'geral',
    productType: null,
    wantsCatalog: false,
    locationPreference: null,
    budgetPreference: null,
    bedroomsPreference: null,
    bathroomsPreference: null,
    nextBestQuestion: null,
    userGoal: null,
    lotSizePreference: null,
    shouldShowPortfolio: false,
    classification: 'Novo',
    lead_temperature: null,
    project: '',
    handoff: false,
    customer_name: '',
    summary: '',
    send_file_category: null,
    appointment_confirmed: false,
    appointment_date: null,
    appointment_time: null,
    appointment_notes: null,
  };
}
