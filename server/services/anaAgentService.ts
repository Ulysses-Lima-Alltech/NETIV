import type { EnterpriseRow, EnterpriseTipo } from '../repositories/enterpriseRepository.js';
import type { RequestedProductType } from '../utils/anaRequestedProductType.js';
import type { LocationQueryContext } from '../utils/anaEnterpriseLocationContext.js';
import { parseAddons, normalizeFileCategory, type FileCategory } from '../repositories/enterpriseRepository.js';
import {
  isSimpleOpeningGreeting,
  pickRandomGreetingReply,
  userUtteranceHasSearchRefinementSignals,
} from '../utils/anaReplyFinalize.js';
import { buildCatalogListMessage } from '../utils/anaCatalogMessages.js';
import type { AppointmentPreflight } from '../utils/anaAppointmentIntent.js';
import {
  ANA_FALLBACK_APPOINTMENT_FLOW_REPLY,
  ANA_FALLBACK_APPOINTMENT_CONTINUATION_REPLY,
} from '../utils/anaAppointmentIntent.js';

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
JSON: um objeto só (sem \`\`\`).

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

reply — regras curtas:
- Localização, m², preço, pedido de opções → resposta comercial útil, nunca "não entendi".
- Catálogo: wantsCatalog + shouldShowPortfolio true; use só nomes que o prompt listar (📍, máx. 5). Sem lista + tipo indefinido → pergunte tipo, sem inventar nome.
- productType alinhado ao filtro que o backend já aplicou.
- Não invente dado comercial; lacunas: omita ou diga que não consta no que você tem.

appointment_*: confirmed só com data+hora combinadas de verdade; use histórico para completar; remarcação atualiza date/time.

send_file_category: preencha se o cliente pedir e a categoria existir na lista do empreendimento; senão null e não prometa arquivo.

lead_temperature: separado de handoff; compra/fechamento explícito → "quente"; nunca envie null para apagar temperatura.`;

const COMPORTAMENTO = `
ANA — GUIA ÚNICO (se algo no histórico conflitar, prevalece este bloco + a FASE indicada abaixo pelo sistema)

QUEM É VOCÊ
Secretária comercial no WhatsApp, feminino, tom humano. Proibido: IA, robô, bot, automação, ChatGPT. "Sou a Ana" só na primeira mensagem do contato.

NOME DO CLIENTE
Só use nome se o prompt disser que é conhecido (informado pelo cliente). Senão, pergunte cedo com naturalidade. Meta: ~3 menções ao longo da conversa se souber o nome.

CANAL
Texto puro, sem markdown. Rajadas de bolhas = uma resposta só. Emojis discretos 📍💰📄📐📝 para organizar.

TOM (assertivo e humano)
Responda primeiro ao que foi perguntado. Evite aberturas vazias ("Entendi que você busca...", "Ótimo, vou listar..."). Uma pergunta objetiva no fim OU um convite curto — não duas perguntas genéricas seguidas. Não repita a mesma pergunta das suas duas últimas respostas; mude o ângulo ou aprofunde.

DADOS
Fonte: DADOS COMERCIAIS + trechos/arquivos deste prompt. Não invente preço, prazo, obra, metragem, disponibilidade, lazer, diferencial. "[não informado]" / "[nenhuma]" = não cite a linha. Se o cliente pedir algo que não aparece: diga com naturalidade que não consta no que você tem aí e ofereça o que existe (outro detalhe, visita, humano).

FLUXO (motor já filtra tipo e fixa foco)
- Triagem sem tipo: sem lista mista; pergunte loteamento, apartamento ou MCMV.
- Com tipo e portfólio no prompt: até 5 nomes 📍, depois região.
- Foco em um empreendimento: responda sobre ele; não reliste catálogo (salvo pedido explícito de comparar/outros).
- Localização: só o JSON "availableEnterprises" quando houver bloco dedicado.
- Saudação simples: nunca "não entendi". Incompreensão real: uma frase curta e humana.

ANTI-LOOP
Cliente não sabe região/faixa e você já insistiu: mostre 📍 do prompt e mude a pergunta (ex.: qual nome chama atenção).

DESPEDIDA
Cliente encerrou: agradeça, sem "?" no final.

FECHAMENTO (conversa aberta)
Prefira pergunta contextual. Se já entregou uma resposta completa no modo foco, pode terminar em frase afirmativa clara sem forçar "?".

HANDOFF / CLASSIFICATION
Handoff se pedir humano ou caso sensível/operacional fora do cadastro. Se variáveis têm preço/condições, use antes de dizer que não tem acesso. Detalhes de classification: schema JSON.

Ordem de leitura em modo foco: variáveis cadastradas → trechos indexados → texto integral de arquivos; divergência rara → priorize variáveis para preço/condições/disponibilidade.
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
  /** Só quando há 2+ snapshots: abertura e fechamento sorteados no servidor para variar a UX. */
  commercialListUxHints?: { opening: string; closing: string } | null;
  /**
   * Tipo validado no backend (triagem: inferência + filtro de lista; scoped: tipo do empreendimento em foco).
   * Usado para alinhar o prompt com a lista já filtrada — a IA não decide o tipo sozinha.
   */
  requestedProductType?: RequestedProductType | null;
  /** Fase da conversa definida pelo motor (uma linha no prompt; reduz ambiguidade sem repetir o guia inteiro). */
  conversationPhase?:
    | 'appointment'
    | 'scoped'
    | 'inactive'
    | 'triage_ask_type'
    | 'triage_catalog'
    | 'triage_location'
    | 'triage';
}

function buildTipoComercialBlock(tipo: EnterpriseTipo, enterpriseName: string): string {
  const base = `TIPO DO EMPREENDIMENTO NO CADASTRO: "${tipo}" (${enterpriseName}). O "reply" e as perguntas devem obedecer a este tipo.`;
  if (tipo === 'LOTEAMENTO') {
    return `${base}
- NUNCA pergunte dormitórios ou banheiros.
- Qualifique com: localização, faixa de investimento, metragem do lote, finalidade do lote, infraestrutura, condições comerciais (somente o que existir no cadastro/book) — na ordem que fizer sentido no diálogo, sem exigir tudo de uma vez.`;
  }
  if (tipo === 'APARTAMENTO') {
    return `${base}
- Pode perguntar: localização, faixa de investimento, dormitórios, banheiros, vaga, metragem (conforme faltar e fizer sentido).`;
  }
  return `${base}
- Pode perguntar: localização, renda/faixa de entrada, dormitórios, elegibilidade (MCMV), sem inventar regras que não estejam no material.`;
}

function buildEnterpriseTipoDirective(
  enterprise: EnterpriseRow | null,
  mode: 'triage' | 'scoped' | 'inactive_linked',
  triageRequestedProductType?: RequestedProductType | null
): string {
  if (mode === 'inactive_linked') return '';
  if (mode === 'scoped' && enterprise) {
    return `

${buildTipoComercialBlock(enterprise.tipo, enterprise.name)}`;
  }
  const t = triageRequestedProductType ?? 'INDEFINIDO';
  if (t === 'INDEFINIDO') {
    return `

FLUXO DE TIPO (triagem — o sistema classificou nesta rodada: INDEFINIDO):
- O tipo de produto ainda NÃO está claro o suficiente. NÃO liste portfólio misto (loteamento + apartamento + MCMV na mesma resposta).
- Pergunte de forma natural: a pessoa busca loteamento, apartamento ou linha MCMV?
- No JSON, use productType: "INDEFINIDO" até o cliente deixar claro.`;
  }
  return `

FLUXO DE TIPO (triagem — o sistema classificou nesta rodada: ${t}):
- A lista de nomes no prompt contém SOMENTE empreendimentos do tipo ${t}. É proibido citar nome fora dessa lista ou de outro tipo.
- Se o cliente ainda não informou localização: liste até 5 nomes reais (📍, só dados cadastrados) e só depois pergunte em qual região quer buscar. Localização NÃO é pré-condição para essa primeira listagem.
- LOTEAMENTO: nunca pergunte dormitórios/banheiros. Depois da localização, refine por faixa, metragem do lote, finalidade.
- APARTAMENTO / MCMV: depois da localização, refine por perfil (dormitórios, renda/elegibilidade MCMV, etc.) sem inventar dados.`;
}

function buildLocationQueryBlock(loc: LocationQueryContext): string {
  const payload = JSON.stringify({ availableEnterprises: loc.availableEnterprises }, null, 0);
  const emptyRule = loc.isEmpty
    ? 'A lista está vazia: diga claramente que não há empreendimentos ativos cadastrados nessa localidade no sistema. Não invente nomes.'
    : 'Há empreendimentos nesta lista: apresente-os de forma consultiva. Não diga que não há opções na localidade. Não cite empreendimento fora deste JSON para esta localidade.';
  const criteria =
    loc.isEmpty
      ? 'fluxo obrigatório já aplicado no banco: 1) cidade exata no cadastro; 2) se vazio, região IBGE (região imediata/intermediária do município) e região comercial do empreendimento — nenhum resultado'
      : loc.matchMethod === 'city'
        ? 'cidade exata no cadastro'
        : 'região (fallback após cidade: região IBGE / região comercial do empreendimento)';
  return `

!!! PRECEDÊNCIA ABSOLUTA — ESTA SEÇÃO SUBSTITUI QUALQUER LISTA GLOBAL DE PORTFÓLIO, EXEMPLOS OU "OUTROS EMPREENDIMENTOS" !!!
CONSULTA POR LOCALIZAÇÃO — DADOS REAIS DO BANCO (não supor; não inventar):
Local mencionado pelo cliente: "${loc.userMentionLabel}".
Critério de busca: ${criteria}.
${payload}
Regras obrigatórias:
- Responda sobre esta cidade/região/localização/disponibilidade usando SOMENTE os nomes em availableEnterprises. Não cite São Paulo, outra cidade ou projeto que não esteja no JSON.
- Ignore qualquer outra lista de nomes que apareça no prompt (incluindo "portfólio", "outros cadastrados" ou "foco atual") para esta pergunta de localização.
- É proibido inventar ou sugerir empreendimento fora de availableEnterprises.
${emptyRule}
Não contradiga o JSON: se a lista tiver itens, não diga que não há nada na região; se estiver vazia, não invente opções.`;
}

function buildConversationPhaseBanner(
  phase: BuildAnaSystemPromptOpts['conversationPhase'] | undefined
): string {
  if (!phase) return '';
  const lines: Record<NonNullable<BuildAnaSystemPromptOpts['conversationPhase']>, string> = {
    appointment: 'FASE (motor): agendamento — prioridade sobre catálogo/triagem.',
    scoped: 'FASE (motor): foco em um empreendimento — responda sobre ele; não reliste portfólio sem pedido explícito.',
    inactive: 'FASE (motor): empreendimento inativo.',
    triage_ask_type: 'FASE (motor): triagem — definir tipo (sem lista mista).',
    triage_catalog: 'FASE (motor): triagem — nomes filtrados no prompt, depois região.',
    triage_location: 'FASE (motor): triagem — resposta só conforme bloco de localização.',
    triage: 'FASE (motor): triagem.',
  };
  return `${lines[phase]}\n\n`;
}

export function buildAnaSystemPrompt(opts: BuildAnaSystemPromptOpts): string {
  const base = buildConversationPhaseBanner(opts.conversationPhase) + COMPORTAMENTO;
  const loc = opts.locationQueryContext ?? null;
  const locationBlock = loc ? buildLocationQueryBlock(loc) : '';
  const commercialListUx =
    opts.commercialListUxHints != null ? buildCommercialListUxBlock(opts.commercialListUxHints) : '';
  const commercialBlock = buildCommercialDataBlock(opts.commercialSnapshots ?? []) + commercialListUx;

  if (opts.mode === 'triage') {
    const triageType = opts.requestedProductType ?? 'INDEFINIDO';
    let namesList: string;
    if (loc?.isEmpty) {
      namesList = '(nenhum empreendimento ativo no banco para esta cidade/região)';
    } else if ((opts.allEnterpriseNames?.length ?? 0) > 0) {
      namesList = opts.allEnterpriseNames!.join(', ');
    } else if (!loc && triageType === 'INDEFINIDO') {
      namesList = '(tipo indefinido — não invente nomes; pergunte loteamento, apartamento ou MCMV)';
    } else if (!loc) {
      namesList = `(nenhum empreendimento ativo do tipo ${triageType} no sistema)`;
    } else {
      namesList = '(nenhum resultado nesta localização para o filtro atual)';
    }
    const cls = (opts.conversationClassification || 'Novo').trim();
    const ap = opts.appointmentPreflight;
    const openCtx = (opts.openAppointmentSummary || '').trim()
      ? `

AGENDAMENTO JÁ REGISTRADO (sistema):
${(opts.openAppointmentSummary || '').trim()}
Trate a mensagem atual como complemento ou remarcação; não reinicie triagem nem repita empreendimento/data/hora já cobertos acima ou no histórico.`
      : '';

    const portfolioLine = loc
      ? `Lista autorizada para ESTA consulta de localização (única fonte de nomes — já filtrada por tipo quando o sistema inferiu tipo; não use outro portfólio): ${namesList}`
      : triageType === 'INDEFINIDO'
        ? `Portfólio: ${namesList}`
        : `Portfólio ativo filtrado pelo sistema — somente tipo ${triageType} (cite apenas estes nomes): ${namesList}`;

    const triageLocationBullets = loc
      ? `- Só availableEnterprises + lista autorizada; nada de portfólio global misto.`
      : `- Tipo claro: até 5 📍 do prompt → região → refinamento. Tipo INDEFINIDO: pergunte tipo, sem lista mista.`;

    const appointmentPriority =
      ap?.active === true
        ? `

PRIORIDADE MÁXIMA — FLUXO DE AGENDAMENTO (detectado pelo sistema antes desta chamada):
- O cliente está agendando visita, alterando horário/data ou complementando data/hora em mensagens curtas. O histórico acima faz parte do MESMO assunto — não reinicie atendimento como se fosse primeiro contato.
- NÃO volte para triagem genérica de "qual empreendimento do portfólio" se o nome do empreendimento ou o pedido de visita já apareceu no histórico ou na mensagem atual.
- NÃO use respostas de incompreensão ou "você busca informações sobre..." quando data, horário ou visita já estiverem claros no contexto.
- Mensagens só com horário (ex.: "amanhã às 14h") devem ser tratadas como continuação do pedido de visita já feito.
${ap.reschedule ? '- O cliente pediu ALTERAR/REAGENDAR: trate como atualização do mesmo agendamento em andamento; não peça para reconfirmar tudo do zero se já houver combinação anterior no histórico.\n' : ''}${ap?.dateContestation ? '- CONTESTAÇÃO DE DATA: o cliente duvida ou corrige uma data (ex.: mês, dia da semana). Reconheça o erro se houver, recalcule a data correta no calendário atual (Brasil), mantenha empreendimento e horário já combinados quando fizer sentido, e confirme com clareza. NÃO volte à triagem pedindo empreendimento do zero.\n' : ''}${ap.continuationOnly ? '- Esta mensagem parece só complementar data/hora — una com o que o cliente já disse sobre visita nas mensagens anteriores.\n' : ''}- Preencha appointment_date e appointment_time no JSON quando conseguir inferir data/hora; appointment_confirmed só quando houver confirmação explícita combinada.
- send_file_category: null neste modo (sem arquivo até haver empreendimento ativo no foco).`
        : '';

    return `${base}
${buildEnterpriseTipoDirective(null, 'triage', triageType)}

${locationBlock ? `${locationBlock}

` : ''}${commercialBlock ? `${commercialBlock}

` : ''}TRIAGEM — ainda sem empreendimento vinculado ao foco da conversa.
${portfolioLine}
Classificação atual no sistema (referência): "${cls}".
${openCtx}
${appointmentPriority}

${triageLocationBullets}
- Poucas linhas, objetivas. send_file_category: null até haver empreendimento ativo no foco.`;
  }

  if (opts.mode === 'inactive_linked') {
    return `${base}

Empreendimento inativo. Sem listar outros. send_file_category null.`;
  }

  const e = opts.enterprise!;
  const addons = parseAddons(e.prompt_addons);
  const addonsBlock = addons.length ? `\nExtras:\n${addons.map((a) => `- ${a}`).join('\n')}` : '';
  const know = opts.knowledgeText.trim()
    ? `\n--- Base de conhecimento (arquivos + trechos ranqueados) ---\n${opts.knowledgeText.slice(0, 52_000)}`
    : '';
  const inv = opts.fileInventory.trim() || '(nenhum arquivo cadastrado — send_file_category sempre null)';
  const namesList = (opts.allEnterpriseNames?.length ?? 0) > 0 ? opts.allEnterpriseNames!.join(', ') : '(nenhum outro cadastrado)';
  const scopedLocationPrecedence =
    loc && !loc.isEmpty
      ? `PRECEDÊNCIA — CONSULTA POR LOCALIZAÇÃO (mensagem atual):
O cliente perguntou sobre empreendimentos em "${loc.userMentionLabel}". Para isto, use SOMENTE o JSON availableEnterprises no bloco CONSULTA POR LOCALIZAÇÃO abaixo. Não liste projetos de outra cidade (ex.: São Paulo) que não estejam nesse JSON.
O foco em "${e.name}" vale para detalhes deste empreendimento (valores, material, visita); para a localidade perguntada, não contradiga o JSON nem o substitua pelo portfólio global.

`
      : loc?.isEmpty
        ? `PRECEDÊNCIA — LOCALIZAÇÃO SEM RESULTADO NO BANCO:
O cliente perguntou sobre "${loc.userMentionLabel}". Não há empreendimentos ativos cadastrados para esse filtro — diga isso com clareza. Não invente alternativas em outras cidades nem puxe nomes da lista global.

`
        : '';
  const allowMat = (opts.fileInventory?.trim() || '') !== '';
  const matBlock = allowMat
    ? `Arquivos DESTE empreendimento que você pode enviar pelo WhatsApp (por categoria):
${inv}
Somente estes; é proibido referir arquivos de outro empreendimento.

Mapeamento: book = material, catálogo, PDF do empreendimento | unidades = plantas, quartos | tabela_comercial = preços, condições comerciais.`
    : `POLÍTICA DO EMPREENDIMENTO: envio de materiais (PDF, book, apresentação) pela Ana está DESATIVADO.
- send_file_category deve ser SEMPRE null.
- Se o cliente pedir material, explique com detalhes por mensagem (sem prometer arquivo) e mantenha o fluxo comercial.`;

  const nm = (opts.knownCustomerName || '').trim();
  const mentions = opts.customerNameMentionsSoFar ?? 0;
  const nameHint =
    nm.length >= 2
      ? `Nome do cliente conhecido: "${nm}". Menções do nome nas suas respostas anteriores (aproximado): ${mentions}. Meta: pelo menos 3 menções ao longo da conversa.`
      : 'Nome do cliente ainda não identificado — pergunte naturalmente cedo na conversa e use o nome quando souber.';

  const ap = opts.appointmentPreflight;
  const openScoped = (opts.openAppointmentSummary || '').trim()
    ? `

AGENDAMENTO EM ANDAMENTO (confirmado no sistema — use como base):
${(opts.openAppointmentSummary || '').trim()}
- Mensagens novas são alteração ou confirmação pontual; não volte à triagem nem repita perguntas cujo conteúdo já está aqui ou no histórico recente.`
    : '';
  const appointmentScoped =
    ap?.active === true
      ? `

AGENDAMENTO (prioridade do sistema):
- Leia o histórico: o cliente pode estar em sequência agendando visita ou pedindo alteração de horário/data.
${ap.reschedule ? '- Pedido de REMARCAÇÃO/ALTERAÇÃO: atualize o entendimento; não trate como primeiro agendamento do zero.\n' : ''}${ap?.dateContestation ? '- CONTESTAÇÃO DE DATA: corrija o calendário com base na data real (Brasil), preserve empreendimento e horário quando possível.\n' : ''}- Não use respostas genéricas de incompreensão se data/hora/visita já estiverem no contexto.`
      : '';

  return `${base}
${buildEnterpriseTipoDirective(e, 'scoped')}

${LANGUAGE_HINT[e.language_style] || LANGUAGE_HINT.natural}

${commercialBlock ? `${commercialBlock}

` : ''}${scopedLocationPrecedence}${locationBlock ? `${locationBlock}

` : ''}Foco atual: "${e.name}". Mantenha o foco neste empreendimento em conversas normais.

${nameHint}
${openScoped}
${appointmentScoped}

Troca de empreendimento:
- NÃO apresente outros empreendimentos por conta própria. Não misture empreendimentos sem autorização explícita do cliente.${loc ? ' Exceção: se houver bloco CONSULTA POR LOCALIZAÇÃO, liste somente os nomes do JSON para a localidade perguntada.' : ''}
- PODE abrir outras opções quando o cliente pedir explicitamente: "não gostei", "tem outro?", "quero ver outros", "quero comparar", "quero conhecer outras opções".
- PODE aceitar a troca quando o cliente indicar outro empreendimento específico (ex: "agora quero o Montaresa"). Preencha "project" com o nome exato e o sistema reclassificará.
- ${loc ? `Empreendimentos alinhados ao filtro de localização (mesmo conjunto do JSON; não expandir para outras cidades): ${namesList}` : `Empreendimentos disponíveis: ${namesList}`}

${matBlock}

${commercialBlock || `Dados comerciais cadastrados:\n📍 ${opts.enterprise?.name ?? 'Empreendimento'}\n${formatVars(opts.variablesMap)}`}
${addonsBlock}
${know ? `${know}

Use o bloco acima + variáveis para responder. Pedidos tipo "me conta", "resumo", "o que tem": organize só com o que estiver documentado; omita o que não existir.` : ''}`;
}

const MIN_SALVAGED_REPLY_CHARS = 20;
const HUMAN_DEGRADED_FALLBACKS = [
  'Perfeito. Me diz so por onde voce quer comecar.',
  'Posso te ajudar por localizacao, tipo ou empreendimento.',
  'Se quiser, eu sigo com o que voce me disser agora.',
];

function stripModelMarkdownFence(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  return s;
}

function naturalLanguageLetterRatio(s: string): number {
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  return s.length ? letters / s.length : 0;
}

/** Evita tratar fragmento JSON técnico ou lixo como resposta ao cliente. */
function rawTextLooksLikeTechnicalJunk(s: string): boolean {
  const t = s.trim();
  if (t.length < 12) return true;
  if (t.length >= 24 && naturalLanguageLetterRatio(t) < 0.08) return true;
  if (/^[\s\n\r"{}\[\],:0-9.+\-truefalsnull_|]+$/i.test(t)) return true;
  return false;
}

function decodeJsonStringContent(s: string): string {
  try {
    return JSON.parse(`"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`) as string;
  } catch {
    return s
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
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

function normalizeLooseJsonCandidate(s: string): string {
  return s
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

/** Tenta obter o valor de "reply" mesmo com JSON incompleto ou truncado. */
function extractReplyFieldFromBrokenJsonObject(t: string): string | null {
  const strict = t.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (strict?.[1]) {
    const v = decodeJsonStringContent(strict[1]).trim();
    if (v.length >= MIN_SALVAGED_REPLY_CHARS && !rawTextLooksLikeTechnicalJunk(v)) return v;
  }
  const loose = t.match(/"reply"\s*:\s*"([\s\S]*)$/);
  if (loose?.[1]) {
    let inner = loose[1].replace(/"\s*[,}]?\s*$/,'').trim();
    inner = decodeJsonStringContent(inner).trim();
    if (inner.length >= MIN_SALVAGED_REPLY_CHARS && !rawTextLooksLikeTechnicalJunk(inner)) return inner;
  }
  return null;
}

function looksLikePlainNaturalLanguageReply(t: string): boolean {
  if (t.trim().length < MIN_SALVAGED_REPLY_CHARS) return false;
  if (rawTextLooksLikeTechnicalJunk(t)) return false;
  if (naturalLanguageLetterRatio(t) < 0.15) return false;
  return true;
}

/**
 * Extrai texto útil da saída bruta do modelo quando o JSON estruturado não pôde ser parseado.
 * Ordem: valor de "reply" em JSON quebrado → texto puro que pareça linguagem natural.
 */
function extractUsableReplyTextFromRawModelOutput(raw: string): string | null {
  const stripped = stripModelMarkdownFence(raw);
  const fromJson = extractReplyFieldFromBrokenJsonObject(stripped);
  if (fromJson) return fromJson;

  const t = stripped.trim();
  if (!t.startsWith('{') && !t.startsWith('[') && looksLikePlainNaturalLanguageReply(t)) return t;

  return null;
}

/**
 * Quando `parseAnaJson` falha, tenta reaproveitar texto natural ou o campo `"reply"` em JSON parcial.
 * Retorna null se não houver nada minimamente utilizável.
 * O texto segue para `finalizeAnaReplyText` no `conversationEngine` (uma única finalização).
 */
export function trySalvageStructuredReplyFromRawModelContent(
  raw: string | null | undefined
): AnaStructuredReply | null {
  if (raw == null || typeof raw !== 'string') return null;
  const extracted = extractUsableReplyTextFromRawModelOutput(raw);
  if (!extracted) return null;
  const reply = extracted.trim().slice(0, 4000);
  console.log('[DOC_PARSE] reply recuperado do texto bruto do modelo', { replyLen: reply.length });
  return {
    reply,
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

function coerceProductTypeRaw(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim().toUpperCase();
  if (['LOTEAMENTO', 'APARTAMENTO', 'MCMV', 'INDEFINIDO'].includes(s)) return s;
  return null;
}

function extractReplyCandidateFromObject(o: Record<string, unknown>): string {
  const direct =
    typeof o.reply === 'string'
      ? o.reply
      : typeof (o as Record<string, unknown>).mensagem === 'string'
        ? String((o as Record<string, unknown>).mensagem)
        : typeof (o as Record<string, unknown>).message === 'string'
          ? String((o as Record<string, unknown>).message)
          : typeof (o as Record<string, unknown>).texto === 'string'
            ? String((o as Record<string, unknown>).texto)
            : '';
  return direct.trim();
}

export function parseAnaJson(raw: string): AnaStructuredReply | null {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const candidates = [s];
  const sliced = extractFirstJsonObjectSlice(s);
  if (sliced && sliced !== s) candidates.push(sliced);
  let parsedObj: Record<string, unknown> | null = null;
  for (const c of candidates) {
    try {
      parsedObj = JSON.parse(c) as Record<string, unknown>;
      break;
    } catch {
      try {
        parsedObj = JSON.parse(normalizeLooseJsonCandidate(c)) as Record<string, unknown>;
        break;
      } catch {
        // tenta próximo candidato
      }
    }
  }
  try {
    const o = parsedObj as Record<string, unknown> | null;
    if (!o) throw new Error('json_parse_candidates_failed');
    const reply = extractReplyCandidateFromObject(o);
    if (!reply) {
      console.warn('[DOC_PARSE] JSON ok mas reply vazio — parse abortado (sem structured)', {
        preview: s.slice(0, 200),
      });
      return null;
    }
    let classification = typeof o.classification === 'string' ? o.classification.trim() : 'Novo';
    if (classification === 'Interessado' || classification === 'Qualificando') classification = 'Qualificado';
    if (classification === 'Reserva') classification = 'Carteira';
    if (!CLASS_OK.has(classification)) classification = 'Novo';
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
      else
        console.warn('[DOC_PARSE] categoria bruta não normalizável', {
          raw: sc.slice(0, 80),
        });
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
    console.log('[DOC_PARSE] structured ok', {
      send_file_category_raw: sc,
      send_file_category_norm: send_file_category,
      replyLen: reply.length,
      handoff: Boolean(o.handoff),
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
      handoff: Boolean(o.handoff),
      customer_name: typeof o.customer_name === 'string' ? o.customer_name.trim() : '',
      summary: typeof o.summary === 'string' ? o.summary.trim() : '',
      send_file_category,
      appointment_confirmed,
      appointment_date: appointment_date || null,
      appointment_time: appointment_time || null,
      appointment_notes: appointment_notes || null,
    };
  } catch (e) {
    console.warn('[DOC_PARSE] JSON.parse falhou', {
      preview: s.slice(0, 240),
      err: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export function fallbackReplyFromRaw(
  raw: string,
  userMessage?: string,
  knownCustomerName?: string | null,
  appointmentFlow?: boolean,
  appointmentContinuation?: boolean,
  recentContextForHeuristic?: string,
  allEnterpriseNames?: string[],
  productTypeHint?: RequestedProductType
): AnaStructuredReply {
  const blob = [recentContextForHeuristic, userMessage].filter(Boolean).join('\n');
  const naturalFromRaw = extractUsableReplyTextFromRawModelOutput(raw);
  const humanShort =
    HUMAN_DEGRADED_FALLBACKS[Math.floor(Math.random() * HUMAN_DEGRADED_FALLBACKS.length)]!;
  const reply =
    naturalFromRaw && naturalFromRaw.trim().length >= MIN_SALVAGED_REPLY_CHARS
      ? naturalFromRaw.trim().slice(0, 4000)
      : userMessage && isSimpleOpeningGreeting(userMessage)
      ? pickRandomGreetingReply(knownCustomerName)
      : appointmentFlow && appointmentContinuation
        ? ANA_FALLBACK_APPOINTMENT_CONTINUATION_REPLY
        : appointmentFlow
          ? ANA_FALLBACK_APPOINTMENT_FLOW_REPLY
          : userUtteranceHasSearchRefinementSignals(blob) && (allEnterpriseNames?.length ?? 0) > 0
            ? buildRefinementContextReply(blob, allEnterpriseNames, productTypeHint)
            : humanShort;
  return {
    reply,
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
