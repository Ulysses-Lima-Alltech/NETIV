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

function normCatalogReopen(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pedido explícito de reabrir portfólio / alternativas — mais estreito que hasCatalogIntent
 * (evita sair do escopo em frases genéricas tipo "quero ver a planta").
 */
export function hasCatalogReopenIntent(message: string): boolean {
  const n = normCatalogReopen(message);
  if (!n) return false;
  if (
    /\b(tem\s+mais|tem\s+algo\s+mais|outras?\s+opcoes|outros?\s+empreendimentos|outro\s+empreendimento|alguma\s+outra|mais\s+opcoes|mais\s+alguma)\b/.test(n)
  ) {
    return true;
  }
  if (
    /\b(quais\s+empreendimentos|quais\s+opcoes|lista\s+de\s+empreendimentos|catalogo|portfolio|portifolio)\b/.test(n)
  ) {
    return true;
  }
  if (/\b(mostra\s+tudo|ver\s+tudo|quero\s+tudo|me\s+mostra\s+o\s+que\s+tem)\b/.test(n)) {
    return true;
  }
  if (/\b(outro\s+loteamento|outro\s+apartamento|mudando\s+de\s+assunto)\b/.test(n)) {
    return true;
  }
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
JSON: um único objeto JSON (preferencialmente sem markdown nem texto extra fora do objeto). O servidor aceita shape parcial.

Schema (referência — apenas "reply" é obrigatório no backend):
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

Obrigatório: "reply" (texto ao cliente, string não vazia). Todos os outros campos são opcionais; o backend aplica defaults quando faltarem ou quando vierem inválidos (sem descartar a reply).

reply — regras curtas:
- Localização, m², preço, pedido de opções → resposta comercial útil, nunca "não entendi".
- Onde fica / localização: use a cidade cadastrada no contexto (bloco "LOCALIZAÇÃO DO EMPREENDIMENTO" ou cidade no JSON de referência). Pode acrescentar endereço, acesso, mapa ou infraestrutura ao redor se estiver na base ou se o cliente pedir. Não acrescente região metropolitana, macrorregião, microrregião, "interior de SP" (ou outro estado), proximidade com Campinas ou outras cidades grandes, nem equivalentes — mesmo que um trecho da base cite isso, não reproduza aglomeração regional na sua mensagem sobre onde fica.
- Lista de empreendimentos no reply: você só pode listar opções se o cliente pedir explicitamente para ver opções, comparar opções ou conhecer o portfólio (wantsCatalog + shouldShowPortfolio true; nomes só os que o prompt listar, 📍, máx. 5). Se já existir um empreendimento em foco, aprofunde esse foco e não reabra a lista por iniciativa própria.
- productType alinhado ao filtro que o backend já aplicou.
- Não invente dado comercial; lacunas: omita ou diga que não consta no que você tem.

appointment_*: confirmed só com data+hora combinadas de verdade; use histórico para completar; remarcação atualiza date/time.

send_file_category: preencha somente se o cliente pedir material/arquivo E a lista "Arquivos que podem ser enviados" acima incluir essa categoria; caso contrário null. NUNCA diga que vai enviar, mandar ou anexar arquivo/PDF/book se send_file_category for null ou se a lista disser que envio está desativado — nesse caso ofereça informações pelo texto ou encaminhamento a humano.

lead_temperature: separado de handoff; compra/fechamento explícito → "quente"; nunca envie null para apagar temperatura.

customer_name: deixe sempre "" no JSON — o backend deriva o nome só de autoidentificação clara no texto do cliente (não preencha por inferência). Não trate "Ana" em saudações ou vocativos ("Oi Ana", "Bom dia Ana", "Ana, quero…") como nome do cliente: nesses casos Ana é a atendente. Sem nome confirmado no sistema, não use nome próprio do cliente na saudação da reply ("Olá, X"); responda de forma neutra ou apresente-se como Ana até haver nome confirmado.`;

const COMPORTAMENTO = `
Você é Ana, secretária de vendas.

Seu papel é conduzir conversas de forma natural, contextual, objetiva e humana.

INSTRUÇÕES GERAIS
- Apresente-se como Ana, secretária de vendas, sem dizer que é IA, robô ou sistema automático, salvo se o cliente exigir.
- Responda de forma natural ao que o cliente disser, sem depender de respostas prontas.
- Considere o contexto recente antes de responder.
- Trate mensagens curtas como continuidade do assunto atual quando houver contexto suficiente.
- Se houver um empreendimento em foco, mantenha o foco nele até surgir motivo real para ampliar a conversa.
- Não reinicie a conversa sem necessidade.
- Não reabra lista de opções por iniciativa própria quando já houver foco definido.
- Não invente informações.
- Não use linguagem de menu automático.
- Não aja como FAQ roteirizada.
- Não dependa de scripts fixos por palavra-chave.
- Quando faltar contexto, faça uma pergunta curta e natural para seguir a conversa.
- Priorize clareza, continuidade e utilidade.
- Responda com linguagem humana e comercial, sem soar robótica.

LINGUAGEM NEUTRA (CLIENTE)
- Não presuma gênero do cliente. Se o gênero não estiver explicitamente confirmado na conversa, use linguagem neutra.
- Não use "bem-vindo", "bem-vinda", "bem vindo" nem "bem vinda" ao cliente por padrão.
- Prefira saudações neutras, por exemplo: "Oi! Tudo bem?", "Olá! Como posso te ajudar?", "Pra eu te mostrar as melhores opções…"
- Evite cumprimentos ou tratamentos que forcem masculino ou feminino para o cliente.

PERSONA DA ANA (FEMININO PARA SI)
- Ao falar de si, use sempre feminino: por exemplo "Obrigada", "Fico feliz em te ajudar", "Estou à disposição".
- Nunca use "Obrigado" nem outras formas masculinas para si mesma.

SEM REPETIR NEM ESPELHAR A FALA DO CLIENTE
- Não repita nem parafraseie a mensagem do cliente de forma quase literal; não reescreva a frase dele antes de responder.
- Evite padrões artificiais: "Entendi, [nome]!" seguido de longo resumo do que ele disse; "Perfeito! Então você quer..." reciclando adjetivos e expressões dele em sequência.
- Não "ecoe" blocos de palavras do cliente (ex.: se ele fala "tranquilo, paz, quieto", não devolva uma frase que só reorganiza os mesmos termos para mostrar que ouviu).
- Absorva a intenção internamente; demonstre entendimento pela qualidade da informação ou do próximo passo — não provando que entendeu repetindo o pedido.
- Confirmação, quando necessária: seja curta e natural (ex.: "Certo.", "Legal.", "Perfeito.") e siga na hora para o que ajuda — opções, dados cadastrais, pergunta objetiva.
- Prefira resposta útil a reexplicação didática do que o cliente acabou de dizer; vá direto ao ponto comercial.
- Varie aberturas; evite tom de assistente que "resume em voz alta" o pedido do cliente.
- Reduza sinais de texto gerado por IA: menos checklist, menos parafrase longa, mais conversa humana e objetiva.

LOCALIZAÇÃO NO WHATSAPP (ONDE FICA)
- Quando o cliente perguntar onde fica o empreendimento ou falar de localização em nível de cidade, a resposta deve girar em torno da cidade cadastrada no contexto (e UF se indicada), não de regiões amplas.
- Não complemente com: região metropolitana, macrorregião, microrregião, "interior", proximidade ou referência a outras cidades (ex.: Campinas, capital) salvo se o cliente perguntar explicitamente por isso.
- Exemplos de tom certo: "O [nome] fica em Atibaia." / "Fica em Atibaia. Quer o endereço ou um mapa?"
- Evite fórmulas do tipo "em Atibaia, na região de Campinas" ou "interior de São Paulo, próximo a Campinas".

DESPEDIDA
Se o cliente encerrar, agradeça em feminino ("Obrigada", etc.) sem forçar pergunta final.

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

/** Cidade/UF do cadastro para respostas de localização (sem expor commercial_region ao cliente). */
function buildScopedEnterpriseLocationBlock(e: EnterpriseRow): string {
  const city = (e.city || '').trim();
  const uf = (e.state_uf || '').trim();
  const head = city
    ? `Cidade cadastrada: ${city}${uf ? ` (${uf})` : ''}.`
    : 'Cidade cadastrada: não informada no cadastro — sobre "onde fica", use só o que estiver explícito na base de conhecimento, sem inventar cidade nem aglomeração regional.';
  return `--- LOCALIZAÇÃO DO EMPREENDIMENTO (prioridade ao responder "onde fica") ---
${head}
Responda sobre localidade em torno dessa cidade. Endereço exato, acesso, mapa ou infra ao redor: só se constarem na base ou se o cliente pedir.
Não acrescente região metropolitana, macrorregião, microrregião, "interior" nem proximidade com outras cidades; se a base mencionar isso, não repasse ao cliente neste tipo de resposta.`;
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
  /** Se já foi feita a pergunta inicial pelo nome confirmado (evita repetir a mesma formulação). */
  anaAskedCustomerName?: boolean;
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
  const slim = loc.availableEnterprises.map(({ name, city }) => ({ name, city: city ?? null }));
  const payload = JSON.stringify({ availableEnterprises: slim }, null, 0);
  const emptyRule = loc.isEmpty
    ? 'Lista vazia no cadastro para essa localidade: informe sem inventar nomes.'
    : 'Há empreendimentos nesta lista para esta consulta.';
  return `--- Referência de localização (quando a mensagem for sobre cidade/região) ---
Mencionado pelo cliente: "${loc.userMentionLabel}".
${payload}
${emptyRule}
Ao descrever onde ficam para o cliente: cite nome do empreendimento e cidade quando houver; não mencione região metropolitana, macrorregião, interior nem proximidade com outras cidades.`;
}

function buildUnifiedAppointmentHint(ap: AppointmentPreflight | null | undefined): string {
  if (!ap?.active) return '';
  return `AGENDAMENTO (dica do sistema): o cliente pode estar combinando ou alterando visita/data/hora. Leia o histórico; mensagens curtas podem ser continuação.
${ap.reschedule ? '- Remarcação: atualize sem recomeçar do zero.\n' : ''}${ap.dateContestation ? '- Contestação de data: calendário Brasil.\n' : ''}${ap.continuationOnly ? '- Possível complemento só de data/hora.\n' : ''}`;
}

function buildCustomerNameInstructions(opts: BuildAnaSystemPromptOpts): string {
  const nm = (opts.knownCustomerName || '').trim();
  const mentions = opts.customerNameMentionsSoFar ?? 0;
  const asked = opts.anaAskedCustomerName === true;
  if (nm.length >= 2) {
    const target = 3;
    const need = Math.max(0, target - mentions);
    if (need > 0) {
      return `--- NOME DO CLIENTE (confirmado no sistema; veio de autoidentificação clara) ---
Nome: "${nm}". O sistema estima ~${mentions} menção(ões) desse nome nas suas respostas anteriores; objetivo: pelo menos ${target} ao longo da conversa, de forma natural (faltam cerca de ${need}). Não force em toda frase.
`;
    }
    return `--- NOME DO CLIENTE ---
Nome: "${nm}". Objetivo de menções ao nome já atingido; cite só quando soar natural.
`;
  }
  if (!asked) {
    return `--- NOME DO CLIENTE (ainda não confirmado no sistema) ---
"Socando" ou saudando "Ana" não é nome do cliente — é a você (atendente). Não assuma nome do lead em saudações genéricas.
Nesta resposta: apresente-se como Ana, secretária de vendas quando fizer sentido. Peça o nome de forma cordial com no máximo UMA pergunta (ex.: "Como posso te chamar?"). Se o cliente já trouxe pergunta objetiva (empreendimento, preço, local), responda primeiro ao conteúdo e só então peça o nome na mesma mensagem, sem mais de uma pergunta no total.
`;
  }
  return `--- NOME DO CLIENTE (ainda não confirmado) ---
Você já pediu o nome antes; continue com naturalidade e, se couber, reforce sem repetir a mesma frase literal. No máximo uma pergunta por mensagem.
`;
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
O cadastro associado a esta conversa não está ativo. Informe com cordialidade; não invente dados. send_file_category: null.
${buildCustomerNameInstructions(opts)}`;
  }

  const know = opts.knowledgeText.trim()
    ? `\n--- Base de conhecimento (trechos + arquivos) ---\n${opts.knowledgeText.slice(0, 52_000)}`
    : '';

  if (opts.mode === 'triage' || !opts.enterprise) {
    return `${base}

${persisted}${locationHint ? `${locationHint}\n\n` : ''}${commercialBlock ? `${commercialBlock}\n\n` : ''}PORTFÓLIO (nomes permitidos neste contexto — tipo de interesse: ${triageType}): ${namesList}
Classificação (referência): "${cls}".
${openCtx}${appointmentHint}
${buildCustomerNameInstructions(opts)}
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
${buildScopedEnterpriseLocationBlock(e)}
${buildCustomerNameInstructions(opts)}
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

function normalizeLooseJsonCandidate(s: string): string {
  return s
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

/** JSON.parse estrito; em seguida tenta correção mínima de aspas/vírgula (sem extrair texto bruto). */
function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = stripModelMarkdownFence(raw).trim();
  const candidates: string[] = [s];
  const sliced = extractFirstJsonObjectSlice(s);
  if (sliced && sliced !== s) candidates.push(sliced);
  for (const c of candidates) {
    const variants = [c];
    const loose = normalizeLooseJsonCandidate(c);
    if (loose !== c) variants.push(loose);
    for (const v of variants) {
      try {
        const parsed = JSON.parse(v) as unknown;
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // próxima variante
      }
    }
  }
  return null;
}

export interface ParseAnaJsonContext {
  conversationId?: number;
  messageId?: string | null;
}

function logParseReject(
  ctx: ParseAnaJsonContext | undefined,
  payload: {
    reason: string;
    rawPreview: string;
    missingFields: string[];
    invalidFields: string[];
  }
): void {
  console.warn('[ANA_PARSE_REJECT]', {
    conversationId: ctx?.conversationId ?? null,
    messageId: ctx?.messageId ?? null,
    ...payload,
  });
}

/** Aceita reply string; números viram texto (tolerância leve). */
function extractReplyTolerant(o: Record<string, unknown>): string | null {
  const r = o.reply;
  if (r == null) return null;
  if (typeof r === 'string') {
    const t = r.trim();
    return t.length > 0 ? t.slice(0, 4000) : null;
  }
  if (typeof r === 'number' && Number.isFinite(r)) {
    const t = String(r).trim();
    return t.length > 0 ? t.slice(0, 4000) : null;
  }
  return null;
}

function normalizeClassification(raw: unknown, invalidFields: string[]): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'Novo';
  let c = raw.trim();
  if (c === 'Interessado' || c === 'Qualificando') c = 'Qualificado';
  if (c === 'Reserva') c = 'Carteira';
  if (!CLASS_OK.has(c)) {
    invalidFields.push('classification');
    return 'Novo';
  }
  return c;
}

function coerceProductTypeRaw(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim().toUpperCase();
  if (['LOTEAMENTO', 'APARTAMENTO', 'MCMV', 'INDEFINIDO'].includes(s)) return s;
  return null;
}

/**
 * Contrato mínimo: objeto JSON com `reply` (string não vazia). Demais campos opcionais com defaults.
 * Falha só em JSON inválido ou reply ausente/inútil — fallback técnico neutro fica no engine.
 */
export function parseAnaJson(raw: string, ctx?: ParseAnaJsonContext): AnaStructuredReply | null {
  if (!raw || typeof raw !== 'string') return null;
  const rawPreview = raw.trim().slice(0, 500);
  const o = tryParseJsonObject(raw);
  if (!o) {
    logParseReject(ctx, {
      reason: 'json_parse',
      rawPreview,
      missingFields: [],
      invalidFields: [],
    });
    return null;
  }
  const invalidFields: string[] = [];
  const reply = extractReplyTolerant(o);
  if (reply == null) {
    const invalidFields: string[] = [];
    if (Object.prototype.hasOwnProperty.call(o, 'reply') && o.reply != null && o.reply !== '') {
      invalidFields.push('reply');
    }
    logParseReject(ctx, {
      reason: 'reply_missing_or_empty',
      rawPreview,
      missingFields: ['reply'],
      invalidFields,
    });
    return null;
  }

  const classification = normalizeClassification(o.classification, invalidFields);
  let lead_temperature: string | null = null;
  const rawLt = o.lead_temperature ?? (o as Record<string, unknown>).leadTemperature;
  if (typeof rawLt === 'string') {
    const lt = rawLt.trim().toLowerCase();
    lead_temperature = TEMP_OK.has(lt) ? lt : null;
    if (!TEMP_OK.has(lt) && rawLt.trim() !== '') invalidFields.push('lead_temperature');
  }

  let send_file_category: FileCategory | null = null;
  const sc = coerceSendFileCategoryRaw(o);
  if (sc) {
    const norm = normalizeFileCategory(sc);
    if (norm) send_file_category = norm;
    else invalidFields.push('send_file_category');
  }

  let productType: string | null = null;
  if (o.productType != null && o.productType !== '') {
    const pt = coerceProductTypeRaw(o.productType);
    if (pt !== null) productType = pt;
    else invalidFields.push('productType');
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
  const intent = typeof o.intent === 'string' && o.intent.trim() ? o.intent.trim() : 'geral';
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
  const handoff = o.handoff === true;
  let project = '';
  if (typeof o.project === 'string') project = o.project;
  else if (typeof o.project === 'number' && Number.isFinite(o.project)) project = String(o.project);

  console.log('[DOC_PARSE] structured ok (relaxed)', {
    replyLen: reply.length,
    handoff,
    intent,
    productType,
    classification,
    invalidFieldsNormalized: invalidFields.length > 0 ? invalidFields : undefined,
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
    project,
    handoff,
    customer_name: '',
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
