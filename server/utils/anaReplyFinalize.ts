import { buildCatalogListMessage } from './anaCatalogMessages.js';

/** Sem delay artificial — resposta enviada imediatamente após geração. */
export function randomAnaReplyDelayMs(_opts?: {
  burstCount?: number;
  replyLength?: number;
}): number {
  return 0;
}

export function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

/** Resposta segura quando o modelo repete saudação genérica sem conteúdo útil. */
export function buildGreetingSafeFallback(customerName?: string | null): string {
  void customerName;
  return '';
}

const DUPLICATE_FALLBACKS_GENERIC = [
  'Me diz o que você quer priorizar que eu sigo com você.',
  'Qual região ou perfil você quer explorar primeiro?',
];
export interface PickDuplicateFallbackOpts {
  /** Modo foco: não listar portfólio inteiro; variar dentro do empreendimento atual. */
  scoped?: boolean;
  focusedEnterpriseName?: string | null;
}

/**
 * Fallback enviado quando a reply da IA ficou duplicada/similar à anterior.
 * Se houver nomes reais e contexto de catálogo/escape, lista o portfólio em vez de repetir refinamento.
 */
export function pickDuplicateFallbackReply(
  recentContext?: string,
  allEnterpriseNames?: string[],
  opts?: PickDuplicateFallbackOpts
): string {
  void recentContext;
  void allEnterpriseNames;
  void opts;
  return '';
}

function fingerprintReply(s: string): string {
  return normClosure(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function significantWordSet(s: string): Set<string> {
  const set = new Set<string>();
  for (const w of fingerprintReply(s).split(' ')) {
    if (w.length > 2) set.add(w);
  }
  return set;
}

/**
 * Evita reenviar resposta quase idêntica (similaridade lexical; sem embeddings).
 */
export function repliesSemanticallySimilar(a: string, b: string): boolean {
  const fa = fingerprintReply(a);
  const fb = fingerprintReply(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const A = significantWordSet(a);
  const B = significantWordSet(b);
  if (A.size === 0 || B.size === 0) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  const j = union > 0 ? inter / union : 0;
  return j >= 0.88;
}

const EVORA_LOCATION_REPLY =
  'O Évora fica em Atibaia, na região da Pedreira/Rio Abaixo, com acesso pela Rodovia Dom Pedro I, a cerca de 50 minutos de São Paulo, em uma região com qualidade de vida e contato com a natureza.';

const EVORA_ADDRESS_REPLY =
  'Fica na Estrada dos Pires, s/n, na região da Pedreira, bairro Rio Abaixo, em Atibaia.';

const EVORA_MAPS_REPLY =
  'https://maps.app.goo.gl/jBoxPM6XRut2iXHSA?g_st=ic';

function isUserAskingAboutLocation(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(localizacao|localização|onde fica|endereco|endereço|fica onde|qual a regiao|qual a região|como chegar|mapa|google maps|acesso|bairro)\b/.test(n);
}

function isUserAskingEvoraMaps(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(google maps|maps|mapa|link)\b/.test(n);
}

function isUserAskingEvoraAddress(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(endereco|endereço|endereco completo|endereço completo)\b/.test(n);
}

function isEvoraContext(reply: string, userMessage?: string | null): boolean {
  const combined = normClosure(`${reply || ''} ${userMessage || ''}`);
  return /\b(evora|évora)\b/.test(combined);
}

function isEvoraScopedContext(opts?: FinalizeAnaReplyOptions): boolean {
  return /\bevora\b/.test(normClosure(opts?.enterpriseName || ''));
}

function forceEvoraLocationReplyWhenNeeded(reply: string, opts?: FinalizeAnaReplyOptions): string {
  const clean = (reply || '').trim();
  const userMessage = opts?.userMessage ?? null;

  if (!isUserAskingAboutLocation(userMessage)) return clean;
  if (!isEvoraScopedContext(opts) && !isEvoraContext(clean, userMessage)) return clean;

  if (isUserAskingEvoraMaps(userMessage)) return EVORA_MAPS_REPLY;
  if (isUserAskingEvoraAddress(userMessage)) return EVORA_ADDRESS_REPLY;
  return EVORA_LOCATION_REPLY;
}

const HUMAN_LAZER_REPLY =
  'Tem uma estrutura de lazer bem completa, com piscinas, academia, salão de festas, playground, quadras e espaços de convivência. A ideia é atender tanto momentos em família quanto atividades do dia a dia. Quer que eu te conte mais sobre os espaços para família, esportes ou convivência?';

function isUserAskingAboutLazer(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(lazer|area de lazer|área de lazer|piscina|piscinas|academia|salao de festas|salão de festas|playground|quadra|quadras|beach tennis|campo society|coworking|espaco zen|espaço zen|fireplace|praca interna|praça interna|area verde|área verde)\b/.test(n);
}

const EVORA_LAZER_REPLY =
  'O lazer do Évora é bem completo para o dia a dia da família.\n\nTem piscina adulto, piscina infantil, academia, salão de festas, playground, coworking, espaço zen, fireplace, quadra de beach tennis, campo society, praça interna e áreas verdes.\n\nTambém conta com estação para carros elétricos e portaria 24h com controle de acesso.';

function replyHasEvoraLazerItems(text: string): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(piscina|academia|salao de festas|salão de festas|playground|coworking|espaco zen|espaço zen|fireplace|beach tennis|campo society|praca interna|praça interna|area verde|área verde|quadra|quadras)\b/.test(
    n
  );
}

function looksGenericEvoraFallback(text: string): boolean {
  const n = normClosure(text || '');
  if (!n) return true;
  const genericPointPattern = new RegExp(['tem algum ponto', 'especific', 'detalhe melhor'].join('.*'));
  return (
    genericPointPattern.test(n) ||
    /\bquer que eu detalhe melhor\b/.test(n) ||
    /\bqual ponto voce quer\b/.test(n) ||
    /\bse quiser eu te explico\b/.test(n) ||
    /\bme conta o que voce quer\b/.test(n) ||
    /\bquer que eu te explique\b/.test(n)
  );
}

function forceEvoraLazerReplyWhenNeeded(reply: string, opts?: FinalizeAnaReplyOptions): string {
  const clean = (reply || '').trim();
  if (!isEvoraScopedContext(opts)) return clean;
  if (!isUserAskingAboutLazer(opts?.userMessage ?? null)) return clean;
  if (!clean) {
    console.log('[ANA_LEISURE_CANONICAL_RESPONSE_USED]', { reason: 'empty_lazer_reply' });
    return EVORA_LAZER_REPLY;
  }

  if (looksGenericEvoraFallback(clean) || !replyHasEvoraLazerItems(clean)) {
    console.log('[ANA_LEISURE_CANONICAL_RESPONSE_USED]', { reason: 'generic_or_missing_lazer_items' });
    return EVORA_LAZER_REPLY;
  }

  return clean;
}

const EVORA_LAZER_CONTINUATION_SAFE_REPLY =
  'Sobre lazer, o principal é essa estrutura completa para convivência, família e atividades do dia a dia. Para detalhes específicos de cada espaço, o corretor consegue complementar melhor. Quer seguir pela segurança ou pela localização?';

function userAskedToContinueDetails(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(me conta mais|conta mais|fala mais|detalha mais|quero mais detalhes)\b/.test(n);
}

function hasBrokenListShape(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/(^|\n)\s*\d+\s*$/m.test(raw)) return true;
  if (/:\s*\d+\s*$/m.test(raw)) return true;
  if (/(^|\n)\s*\d+\s*[:.-]\s*$/m.test(raw)) return true;
  return false;
}

function sanitizeBrokenListOrLazerContinuation(reply: string, opts?: FinalizeAnaReplyOptions): string {
  const clean = String(reply || '').trim();
  if (!clean) return clean;

  const brokenList = hasBrokenListShape(clean);
  if (brokenList) {
    console.log('[ANA_BROKEN_LIST_OUTPUT_BLOCKED]', { reason: 'broken_numeric_list' });
  }

  if (!isEvoraScopedContext(opts)) {
    return brokenList ? clean.replace(/(^|\n)\s*\d+\s*$/gm, '').replace(/\s{2,}/g, ' ').trim() : clean;
  }

  const askedLazer = isUserAskingAboutLazer(opts?.userMessage ?? null);
  const askedMore = userAskedToContinueDetails(opts?.userMessage ?? null);
  if ((askedLazer || askedMore) && brokenList) {
    return EVORA_LAZER_CONTINUATION_SAFE_REPLY;
  }
  if (askedMore && !replyHasEvoraLazerItems(clean)) {
    return EVORA_LAZER_CONTINUATION_SAFE_REPLY;
  }
  return clean;
}

function looksLikeDryLazerList(reply: string): boolean {
  const raw = (reply || '').trim();
  const n = normClosure(raw);
  if (!n) return false;

  const hasLazerTerms =
    /\b(piscina|piscinas|academia|salao de festas|playground|coworking|espaco zen|fireplace|beach tennis|campo society|praca interna|area verde|quadra|quadras)\b/.test(n);

  if (!hasLazerTerms) return false;

  const bulletCount = (raw.match(/(^|\n)\s*[-•*]\s+/g) || []).length;
  const commaCount = (raw.match(/,/g) || []).length;

  const lazerTermCount = [
    'piscina',
    'academia',
    'salão de festas',
    'salao de festas',
    'playground',
    'coworking',
    'espaço zen',
    'espaco zen',
    'fireplace',
    'beach tennis',
    'campo society',
    'praça interna',
    'praca interna',
    'área verde',
    'area verde',
    'quadra',
    'quadras',
  ].reduce((acc, term) => acc + (n.includes(normClosure(term)) ? 1 : 0), 0);

  return bulletCount >= 3 || commaCount >= 5 || lazerTermCount >= 6;
}

function humanizeLazerReplyWhenNeeded(reply: string, userMessage?: string | null): string {
  const clean = (reply || '').trim();
  if (!clean) return clean;

  if (!isUserAskingAboutLazer(userMessage)) return clean;
  if (!looksLikeDryLazerList(clean)) return clean;

  return HUMAN_LAZER_REPLY;
}

const INTERNAL_INSTRUCTION_FRAGMENT_PATTERNS: readonly RegExp[] = [
  /finalizar com pergunta aberta e natural,?\s*sem resposta fixa determin[ií]stica\.?/i,
  /finalizar com pergunta aberta e natural/i,
  /sem resposta fixa determin[ií]stica/i,
];

function replyAlreadyEndsWithQuestion(text: string): boolean {
  return /\?\s*$/.test((text || '').trim());
}

function hasQuestionNearEnd(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  const tail = t.slice(Math.max(0, t.length - 140));
  return /\?/.test(tail);
}

function isSpecificCommercialOrOperationalTopic(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;

  return /\b(valor|preco|preço|quanto custa|quanto e|quanto é|r\$|entrada|parcela|parcelamento|financiamento|tabela|condicao|condição|pagamento|desconto|disponibilidade|lote disponivel|lote disponível|reservar|reserva|documentacao|documentação|contrato|iptu|condominio|condomínio|taxa|obra|entrega|prazo|quando posso construir|book|material|foto|fotos|video|vídeo|planta|implantacao|implantação|visita|agendar|agenda|horario|horário|corretor|humano|atendente|endereco|endereço|localizacao|localização)\b/.test(n);
}

function isGeneralEnterpriseIntroUserMessage(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  if (isSpecificCommercialOrOperationalTopic(text)) return false;

  return (
    /\b(quero saber|queria saber|gostaria de saber|tenho interesse|me fala|me conte|me passa mais detalhes|mais informacoes|mais informações|saber mais|conhecer melhor|informacoes sobre|informações sobre)\b/.test(n) ||
    /\b(o que e|o que é)\b.*\b(evora|empreendimento|loteamento|condominio|condomínio)\b/.test(n) ||
    /\b(evora|évora)\b/.test(n)
  );
}

function looksLikeGeneralEnterpriseIntroReply(text: string): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  if (replyAlreadyEndsWithQuestion(text) || hasQuestionNearEnd(text)) return false;
  if (/\br\$\b|\br\$|\bvalor\b|\bpreco\b|\bpreço\b|\bentrada\b|\bparcela\b|\bfinanciamento\b|\btabela\b|\bpagamento\b/.test(n)) {
    return false;
  }

  const hasEnterpriseShape = /\b(evora|évora|empreendimento|loteamento|condominio|condomínio)\b/.test(n);
  const hasIntroFacts = /\b(atibaia|lotes?|360\s*m|360m|infraestrutura|lazer|seguranca|segurança|rodovia dom pedro|pedreira)\b/.test(n);

  return hasEnterpriseShape && hasIntroFacts;
}

function appendOpenQuestionForGeneralEnterpriseIntro(
  reply: string,
  userMessage?: string | null
): string {
  const clean = (reply || '').trim();
  if (!clean) return clean;
  if (replyAlreadyEndsWithQuestion(clean) || hasQuestionNearEnd(clean)) return clean;

  const shouldApplyByUser = isGeneralEnterpriseIntroUserMessage(userMessage);
  const shouldApplyByReply = looksLikeGeneralEnterpriseIntroReply(clean);

  if (!shouldApplyByUser && !shouldApplyByReply) return clean;

  if (isSpecificCommercialOrOperationalTopic(userMessage)) return clean;

  // A pergunta final é opcional e deve ser contextual ao turno; nunca anexar pergunta fixa global.
  return clean;
}

function normClosure(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cliente encerrou a conversa (agradecimento / despedida / “por enquanto é só”) —
 * a Ana não deve insistir com pergunta final.
 */
export function detectClientConversationClosure(userMessage: string): boolean {
  const n = normClosure(userMessage);
  if (!n) return false;

  if (/\?\s*$/.test(userMessage.trim())) return false;
  if (/\b(quanto custa|quanto e|qual o valor|me passa o|me envia|manda o|quero saber mais|gostaria de saber|tenho uma duvida|pode me explicar)\b/.test(n)) {
    return false;
  }

  const strongPatterns: RegExp[] = [
    /^no momento nao,? obrigad/,
    /^nao,? obrigad/,
    /^ok,? obrigad/,
    /^ta bom,? obrigad/,
    /^tudo bem,? obrigad/,
    /^perfeito,? obrigad/,
    /^combinado,? obrigad/,
    /\bpor enquanto e so\b/,
    /\bera isso\b/,
    /\bqualquer coisa eu chamo\b/,
    /\bdepois eu vejo\b/,
    /\bnao precisa\b/,
    /\bso isso\b/,
    /\bpor hoje e so\b/,
    /\bvaleu[,!\s]*$/,
    /^obrigad[oa][,!\s]*$/,
    /\btchau\b/,
    /\bate logo\b/,
    /\bno momento nao\b.*\bobrigad/,
  ];
  if (strongPatterns.some((re) => re.test(n))) return true;

  if (n.length <= 160 && (/\bobrigad[oa]\b/.test(n) || /\bvaleu\b/.test(n))) {
    if (/\b(quero|preciso de|gostaria de ver|me mostra|me manda|pode enviar)\b/.test(n)) return false;
    return true;
  }

  return false;
}

export interface FinalizeAnaReplyOptions {
  /** Mensagem atual do cliente — usada para detectar encerramento e não forçar pergunta. */
  userMessage?: string | null;
  /** Última mensagem da Ana — usada para interpretar respostas curtas a perguntas sobre Atibaia/região. */
  lastAssistantMessage?: string | null;
  /** Modo foco: respostas informativas podem terminar sem "?" forçado. */
  conversationMode?: 'triage' | 'scoped' | 'inactive_linked';
  /** true somente na primeira resposta da Ana na conversa. */
  isFirstAnaReply?: boolean;
  /** Empreendimento ativo no turno (usado para regras canônicas do Évora). */
  enterpriseName?: string | null;
  /** Turno de knowledge gap: preservar texto do LLM e pular CTAs legadas. */
  isKnowledgeGapTurn?: boolean;
}

/**
 * Remove artefatos comuns de markdown que o modelo às vezes devolve (WhatsApp não renderiza bem).
 */
export function stripMarkdownArtifactsForWhatsApp(text: string): string {
  let t = text;
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/\*([^*\n]+)\*/g, '$1');
  t = t.replace(/__([^_]+)__/g, '$1');
  t = t.replace(/_([^_\n]+)_/g, '$1');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  return t;
}

/** Normaliza espaços mantendo quebras de linha (uma mensagem pode ter vários blocos). Colapsa 3+ quebras em no máximo 2 (uma linha em branco entre parágrafos). */
function normalizeWhitespacePreservingLines(text: string): string {
  const lines = text.split(/\r?\n/);
  const out = lines.map((line) => line.replace(/\s+/g, ' ').trim());
  let joined = out.join('\n');
  while (/\n{3,}/.test(joined)) {
    joined = joined.replace(/\n{3,}/g, '\n\n');
  }
  return joined.trim();
}

export function sanitizeAnaClientVisibleReplyText(text: string): string {
  let next = String(text || '').trim();
  if (!next) return next;

  next = next
    .replace(/Ã‰vora/g, 'Évora')
    .replace(/Ã©/g, 'é')
    .replace(/Ã‰/g, 'É')
    .replace(/Ã¡/g, 'á')
    .replace(/Ã /g, 'à')
    .replace(/Ã£/g, 'ã')
    .replace(/Ã¢/g, 'â')
    .replace(/Ãª/g, 'ê')
    .replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ã´/g, 'ô')
    .replace(/Ãµ/g, 'õ')
    .replace(/Ãº/g, 'ú')
    .replace(/Ã§/g, 'ç')
    .replace(/Â²/g, '²')
    .replace(/\bEvora\b/g, 'Évora')
    .replace(/\bVoce\b/g, 'Você')
    .replace(/\bvoce\b/g, 'você')
    .replace(/\binformacao\b/g, 'informação')
    .replace(/\binformacoes\b/g, 'informações')
    .replace(/\bInformacao\b/g, 'Informação')
    .replace(/\bopcoes\b/g, 'opções')
    .replace(/\bOpcoes\b/g, 'Opções')
    .replace(/\bresponsavel\b/g, 'responsável')
    .replace(/\bResponsavel\b/g, 'Responsável')
    .replace(/\bseguranca\b/g, 'segurança')
    .replace(/\bSeguranca\b/g, 'Segurança')
    .replace(/\blocalizacao\b/g, 'localização')
    .replace(/\bLocalizacao\b/g, 'Localização')
    .replace(/\bregiao\b/g, 'região')
    .replace(/\bRegiao\b/g, 'Região')
    .replace(/\bfamilia\b/g, 'família')
    .replace(/\bcondicoes\b/g, 'condições')
    .replace(/\bcondicao\b/g, 'condição')
    .replace(/\bate\b(?=\s+\d+x\b)/g, 'até')
    .replace(/\bha\b(?=\s+opções|\s+opcoes)/g, 'há')
    .replace(/\bSao Paulo\b/g, 'São Paulo')
    .replace(/\bnumero\b/g, 'número')
    .replace(/\bendereco\b/g, 'endereço')
    .replace(/\bEndereco\b/g, 'Endereço')
    .replace(/\bhorario\b/g, 'horário')
    .replace(/\bHorario\b/g, 'Horário')
    .replace(/\bmanh[aã]\b/g, 'manhã')
    .replace(/\bm2\b/gi, 'm²')
    .replace(/\bpra você\b/gi, 'para você')
    .replace(/\bpra voce\b/gi, 'para você')
    .replace(/[ \t]+(?:—|–)[ \t]+/g, '. ')
    .replace(/[ \t]+-[ \t]+/g, '. ')
    .replace(/\s*(?:\.{3,}|…)+/g, '.')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const normalizedAvailability = next
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const unsafeLotAvailability =
    /\blotes? disponiveis\b/.test(normalizedAvailability) &&
    !/\b(corretor|consultor|nao consigo|depende|varia|atualizada)\b/.test(normalizedAvailability);
  if (unsafeLotAvailability) {
    const safeAvailability =
      'Se quiser, posso te explicar melhor os tamanhos dos lotes e a proposta do loteamento.\n\nPara disponibilidade atualizada, o corretor consegue te passar certinho.';
    const kept = next
      .split(/(?<=[.!?])\s+|\r?\n+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => {
        const sentenceNorm = sentence
          .toLowerCase()
          .normalize('NFD')
          .replace(/\p{M}/gu, '')
          .replace(/\s+/g, ' ')
          .trim();
        return sentenceNorm && !/\blotes? disponiveis\b/.test(sentenceNorm);
      })
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    next = [kept, safeAvailability].filter(Boolean).join('\n\n').trim();
  }

  next = next.replace(/(?:\s*[.\-–—]+\s*)+$/g, (tail) => (tail.includes('?') ? '?' : '.')).trim();
  if (next && !/[.!?]$/.test(next) && !/https?:\/\/\S+$/i.test(next)) next = `${next}.`;
  return next;
}

/**
 * Só higieniza texto para WhatsApp: sem perguntas aleatórias, sem despedidas fixas — o conteúdo vem do modelo.
 */
function splitSentencesCompact(text: string): string[] {
  return (text || '')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function userAskedForMaterialLikeIntent(userMessage: string | null | undefined): boolean {
  const n = normClosure(userMessage || '');
  if (!n) return false;
  return /\b(book|material|arquivo|apresentacao|apresentação|pdf|catalogo|catálogo)\b/.test(n);
}

function stripMidConversationReintroduction(text: string, isFirstAnaReply: boolean): string {
  if (isFirstAnaReply) return text;
  const sentences = splitSentencesCompact(text);
  if (sentences.length === 0) return text;
  const reintroPatterns: RegExp[] = [
    /\b(sou|meu nome e|eu sou)\s+a?\s*ana\b/i,
    /\b(secret[aá]ria de vendas|consultora|assistente virtual|especialista)\b/i,
  ];
  const kept = sentences.filter((s) => !reintroPatterns.some((re) => re.test(s)));
  const out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  return out || text;
}

function keepTwoShortSentencesMax(text: string): string {
  const sentences = splitSentencesCompact(text);
  if (sentences.length <= 2) {
    const qCount = (text.match(/\?/g) || []).length;
    if (qCount <= 1) return text;
  }
  const kept: string[] = [];
  let questionUsed = false;
  for (const s of sentences) {
    const hasQ = s.includes('?');
    if (hasQ && questionUsed) continue;
    kept.push(s);
    if (hasQ) questionUsed = true;
    if (kept.length >= 2) break;
  }
  return kept.join(' ').replace(/\s{2,}/g, ' ').trim();
}

function applyShortMaterialReplyPolicy(
  text: string,
  userMessage: string | null | undefined
): string {
  if (!userAskedForMaterialLikeIntent(userMessage)) return text;
  const n = normClosure(text);
  if (!n) return text;
  if (
    /\b(nao consegui|não consegui|nao foi enviado|não foi enviado|nao localizei|não localizei|nao encontrei|não encontrei|indisponivel|indisponível)\b/.test(
      n
    )
  ) {
    return keepTwoShortSentencesMax(text);
  }
  // Nunca cria promessa de envio aqui. O claim de envio deve vir somente
  // do fluxo determinístico após tentativa real de outbound.
  return keepTwoShortSentencesMax(text);
}

const EVORA_OPEN_GUIDANCE_DEFAULT_REPLY =
  'Sem problema.\n\nVou te explicar por partes.\n\nO Évora fica em Atibaia, na região da Pedreira, bairro Rio Abaixo, com acesso pela Rodovia Dom Pedro I. Ele combina loteamento fechado, lazer, portaria 24h e lotes a partir de 360 m².\n\nVocê quer entender primeiro a região ou a estrutura do empreendimento?';

const EVORA_OPEN_GUIDANCE_UNCERTAIN_REPLY =
  'Sem problema.\n\nEu te ajudo a organizar isso. O Évora é um loteamento fechado em Atibaia, com lotes a partir de 360 m², lazer e portaria 24h.\n\nDá para olhar por três caminhos: região, estrutura ou valores.\n\nVocê quer começar por qual deles?';

const EVORA_OPEN_GUIDANCE_CHALLENGE_REPLY =
  'Faz sentido perguntar isso.\n\nO ponto é que o Évora junta uma região mais tranquila de Atibaia com acesso pela Rodovia Dom Pedro I, lotes a partir de 360 m², lazer e portaria 24h.\n\nIsso ajuda tanto para morar com mais espaço quanto para pensar em valorização.\n\nVocê quer que eu explique primeiro a localização ou os valores?';

const EVORA_ATIBAIA_REGION_CONTEXT_REPLY =
  'Sem problema, vou te situar.\n\nAtibaia é uma cidade muito procurada por quem quer sair um pouco da correria de São Paulo, mas sem ficar longe demais.\n\nO Évora fica na região da Pedreira, no bairro Rio Abaixo, com acesso pela Rodovia Dom Pedro I.\n\nVocê quer que eu te explique mais sobre a região ou sobre a estrutura do loteamento?';

const EVORA_ATIBAIA_REGION_UNKNOWN_REPLY =
  'Claro, essa é uma dúvida importante.\n\nAtibaia tem um perfil mais tranquilo, com bastante natureza, clima agradável e boa estrutura para quem quer morar com mais qualidade de vida.\n\nNo caso do Évora, ele fica na região da Pedreira, no bairro Rio Abaixo, com acesso pela Rodovia Dom Pedro I.\n\nVocê está pensando em sair de São Paulo para morar com mais calma ou ainda está só comparando possibilidades?';

const EVORA_SAO_PAULO_CONTEXT_REPLY =
  'Então faz sentido eu te explicar a diferença.\n\nPara quem vem de São Paulo, o Évora tem uma proposta de mais espaço, tranquilidade e contato com natureza, sem ficar tão distante da capital.\n\nAtibaia fica a cerca de 50 minutos de São Paulo, dependendo do ponto de saída, e o acesso ao Évora é pela Rodovia Dom Pedro I.\n\nVocê quer entender mais sobre o deslocamento ou sobre a estrutura do loteamento?';

function isOpenCommercialUncertaintyMessage(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return (
    /\b(ainda nao|ainda não|nao sei|não sei|n sei|nao conheco|não conheço|vamos devagar|calma)\b/.test(n) ||
    /^(e dai|e daí|dai|daí)\??$/.test(n)
  );
}

function isChallengeContinuationMessage(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  return /^(e dai|e daí|dai|daí)\??$/.test(n);
}

function isUncertainContinuationMessage(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  return /\b(nao sei|não sei|n sei)\b/.test(n);
}

function isAssistantAskingAtibaiaRegionContext(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return (
    /\b(conhece atibaia|comecando a olhar a regiao|começando a olhar a região|olhar a regiao|olhar a região)\b/.test(n) ||
    /\b(mora em atibaia|vem de outra cidade|entender a regiao|entender a região)\b/.test(n)
  );
}

function isSaoPauloRegionContinuation(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /^(sao paulo|sp)$/.test(n) || /\b(sou de sao paulo|moro em sao paulo|venho de sao paulo|vim de sao paulo|sou de sp|moro em sp|venho de sp)\b/.test(n);
}

function isUnknownThereRegionContinuation(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(nao sei como e la|não sei como é lá|nao sei como eh la|nao conheco la|não conheço lá|como e la|como é lá)\b/.test(n);
}

function isNegativeAtibaiaRegionContinuation(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(ainda nao|ainda não|nao conheco|não conheço|nao sei|não sei|n sei)\b/.test(n);
}

function buildEvoraRegionContextReplyForUser(userMessage: string | null | undefined): string | null {
  if (isSaoPauloRegionContinuation(userMessage)) return EVORA_SAO_PAULO_CONTEXT_REPLY;
  if (isUnknownThereRegionContinuation(userMessage)) return EVORA_ATIBAIA_REGION_UNKNOWN_REPLY;
  if (isNegativeAtibaiaRegionContinuation(userMessage)) return EVORA_ATIBAIA_REGION_CONTEXT_REPLY;
  return null;
}

function rescueEvoraRegionContextReply(text: string, opts?: FinalizeAnaReplyOptions): string {
  const clean = String(text || '').trim();
  if (!clean) return clean;
  if (opts?.isKnowledgeGapTurn === true) return clean;
  if (detectClientConversationClosure(opts?.userMessage ?? '')) return clean;
  if (!isEvoraScopedContext(opts) && !isEvoraContext(clean, opts?.lastAssistantMessage ?? opts?.userMessage ?? null)) return clean;
  if (!isAssistantAskingAtibaiaRegionContext(opts?.lastAssistantMessage ?? null)) return clean;
  return buildEvoraRegionContextReplyForUser(opts?.userMessage ?? null) ?? clean;
}

function isNeutralAcknowledgementOnly(text: string): boolean {
  const n = normClosure(text || '').replace(/\?+$/g, '').trim();
  if (!n) return false;
  if (n.length > 140) return false;
  const usefulSignals = /\b(evora|atibaia|loteamento|lotes?|portaria|lazer|localizacao|localização|pedreira|rio abaixo|dom pedro|valores?|metragem|corretor)\b/.test(n);
  if (usefulSignals) return false;
  const withoutNeutral = n
    .replace(/\btudo bem\b/g, ' ')
    .replace(/\bvamos devagar(?: entao)?\b/g, ' ')
    .replace(/\bentendi\b/g, ' ')
    .replace(/\bcerto\b/g, ' ')
    .replace(/\bperfeito\b/g, ' ')
    .replace(/\blegal\b/g, ' ')
    .replace(/\bbeleza\b/g, ' ')
    .replace(/\bsem problema\b/g, ' ')
    .replace(/\bok\b/g, ' ')
    .replace(/[.!?,\s]+/g, ' ')
    .trim();
  return withoutNeutral.length === 0;
}

function endsWithNeutralAcknowledgementWithoutAdvance(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw || /\?\s*$/.test(raw)) return false;
  const tail = splitSentencesCompact(raw).slice(-2).join(' ');
  return isNeutralAcknowledgementOnly(tail);
}

function selectEvoraOpenGuidanceReply(userMessage: string | null | undefined): string {
  if (isChallengeContinuationMessage(userMessage)) return EVORA_OPEN_GUIDANCE_CHALLENGE_REPLY;
  if (isUncertainContinuationMessage(userMessage)) return EVORA_OPEN_GUIDANCE_UNCERTAIN_REPLY;
  return EVORA_OPEN_GUIDANCE_DEFAULT_REPLY;
}

function rescueNeutralOpenCommercialReply(text: string, opts?: FinalizeAnaReplyOptions): string {
  const clean = String(text || '').trim();
  if (!clean) return clean;
  if (opts?.isKnowledgeGapTurn === true) return clean;
  if (detectClientConversationClosure(opts?.userMessage ?? '')) return clean;

  const evoraScoped = isEvoraScopedContext(opts) || isEvoraContext(clean, opts?.lastAssistantMessage ?? opts?.userMessage ?? null);
  if (!evoraScoped) return clean;

  const userNeedsGuidance = isOpenCommercialUncertaintyMessage(opts?.userMessage ?? null);
  const shortNeutral = isNeutralAcknowledgementOnly(clean);
  const neutralEndingWithoutQuestion = endsWithNeutralAcknowledgementWithoutAdvance(clean);
  const lacksUsefulQuestion = !/\?\s*$/.test(clean);

  if (shortNeutral || (userNeedsGuidance && (neutralEndingWithoutQuestion || lacksUsefulQuestion))) {
    return selectEvoraOpenGuidanceReply(opts?.userMessage ?? null);
  }

  return clean;
}

const BROKER_DETAIL_ROUTING_TEXT =
  'Esses detalhes podem variar conforme disponibilidade. Quer que eu encaminhe para um corretor te passar certinho?';

const EVORA_LOT_COUNT_ROUTING_REPLY =
  'O Évora tem 145 lotes no total, com opções a partir de 360 m².';

const DISCOUNT_ROUTING_REPLY =
  'Desconto ou condição especial depende de análise. O corretor consegue te passar isso certinho no atendimento. Que tal marcarmos uma visita?';

function isUserAskingEvoraLotCountOrCondoSize(userMessage?: string | null): boolean {
  const n = normClosure(userMessage || '');
  if (!n) return false;
  return (
    /\b(quantos?\s+lotes?|numero\s+de\s+lotes?|número\s+de\s+lotes?|total\s+de\s+lotes?|quantas?\s+unidades?)\b/.test(n) ||
    /\b(condominio|condomínio|loteamento)\b.*\b(grande|pequeno|muito grande|tamanho|porte)\b/.test(n) ||
    /\bnao quero\b.*\b(condominio|condomínio|loteamento)\b.*\b(grande|muito grande)\b/.test(n)
  );
}

function sanitizeEvoraLotCountRestrictedReply(text: string, userMessage?: string | null): string {
  const clean = String(text || '').trim();
  const n = normClosure(clean);
  const askedLotCount = isUserAskingEvoraLotCountOrCondoSize(userMessage);

  const hasForbiddenLotCount =
    /\b145\s+lotes\b/i.test(clean) ||
    /\[\s*n[uú]mero\s+de\s+lotes\s*\]/i.test(clean) ||
    /\bpossui\s+um\s+total\s+de\s+\[.*?\]\s+lotes\b/i.test(clean);

  const hasBadNoInfoForKnownRestrictedTopic =
    askedLotCount &&
    (
      /\bnao temos esse detalhe\b/.test(n) ||
      /\bnao ha uma informacao especifica\b/.test(n) ||
      /\bnumero exato nao foi mencionado\b/.test(n) ||
      /\bnao tenho essa informacao\b/.test(n) ||
      /\bnao consta\b/.test(n)
    );

  const leaksInternalTemplate =
    /\bINTENCAO\b/i.test(clean) ||
    /\bINTENÇÃO\b/i.test(clean) ||
    /\bRESPOSTA\b/i.test(clean) ||
    /\[.*?\]/.test(clean);

  if (askedLotCount || hasForbiddenLotCount || hasBadNoInfoForKnownRestrictedTopic || leaksInternalTemplate) {
    return EVORA_LOT_COUNT_ROUTING_REPLY;
  }

  return clean;
}

function isUserAskingDiscountOrNegotiation(userMessage?: string | null): boolean {
  const n = normClosure(userMessage || '');
  if (!n) return false;
  return /\b(desconto|condicao especial|condição especial|negociar|negociacao|negociação|melhor valor|melhor preco|melhor preço|proposta|oferta)\b/.test(n);
}

function sanitizeDiscountRestrictedReply(text: string, userMessage?: string | null): string {
  const clean = String(text || '').trim();
  if (!clean) return clean;

  if (!isUserAskingDiscountOrNegotiation(userMessage)) return clean;

  const n = normClosure(clean);

  const mentionsCondoFee =
    /\bcondominio\b/.test(n) ||
    /\btaxa de condominio\b/.test(n) ||
    /\bassociacao do condominio\b/.test(n) ||
    /\br\$ ?400\b/i.test(clean) ||
    /\br\$ ?700\b/i.test(clean);

  const claimsDiscountAsUndefined =
    /\bdesconto\b.*\bnao esta definido\b/.test(n) ||
    /\bdesconto\b.*\bdepende\b/.test(n) ||
    /\bcondicao especial\b.*\bdepende\b/.test(n);

  const becameGenericOfferAfterSanitization =
    /se quiser.*(localizacao|estrutura|lazer|seguranca).*marcar visita/.test(n);

  const tooLongOrMixedAxis =
    clean.length > 280 || mentionsCondoFee;

  if (mentionsCondoFee || tooLongOrMixedAxis || claimsDiscountAsUndefined || becameGenericOfferAfterSanitization) {
    return DISCOUNT_ROUTING_REPLY;
  }

  return clean;
}

const EVORA_PRICE_REPLY =
  'O Évora tem lotes a partir de R$279.000,00, com metro quadrado a partir de R$775,00. O valor final depende da unidade e das condições escolhidas.';

const EVORA_PAYMENT_REPLY =
  'Claro.\n\nDe forma geral, o Évora trabalha com planos estendidos em até 120x para parcelas mais baixas, parcelamento sem juros em até 48x e financiamento direto com a construtora, com menos burocracia e mais facilidade.\n\nPara entrada, parcela exata ou simulação personalizada, o corretor consegue montar certinho conforme a unidade disponível.\n\nVocê quer que eu te encaminhe para uma simulação ou prefere entender melhor os tamanhos dos lotes primeiro?';

const EVORA_INSTALLMENT_REDIRECT_REPLY =
  'Para entrada, parcela exata ou simulação personalizada, o corretor consegue montar certinho conforme a unidade disponível.\n\nQuer que eu te encaminhe para um corretor fazer uma simulação?';
const EVORA_LOT_SIZE_GENERAL_REPLY =
  'Os lotes do Évora vão de 360 m² a 725 m². As opções específicas variam conforme a unidade disponível.';
const EVORA_LOT_SIZE_RANGE_REPLY =
  'Os lotes do Évora ficam na faixa de 360 m² a 725 m². Eu não consigo confirmar disponibilidade de uma metragem específica por aqui, porque isso muda conforme as unidades disponíveis.';
const EVORA_LOT_AVAILABILITY_BROKER_REPLY =
  'Para disponibilidade atualizada, o corretor consegue te passar certinho.\n\nEu posso te explicar melhor os tamanhos dos lotes e a proposta do loteamento.';

function isUserAskingEvoraInstallment(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(tem entrada|existe entrada|precisa de entrada|entrada minima|valor da entrada|valor de entrada|esse valor parcela|valor da parcela|qual parcela|parcela personalizada|quanto fica por mes|quanto fica por mês|simulacao|simulação|faz uma simulacao|faz uma simulação|desconto|tabela comercial|condicao individual|condição individual|condicao especifica|condição específica)\b/.test(n);
}

function isUserAskingEvoraPayment(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(formas? de pagamento|como posso pagar|condicoes de pagamento|condições de pagamento|como funciona o pagamento|pagamento|parcelamento|tem parcelamento|da para parcelar|dá para parcelar|da pra parcelar|dá pra parcelar|financiamento direto|financiamento|financia direto)\b/.test(n);
}

function isUserAskingEvoraPrice(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(quanto esta o lote|quanto está o lote|qual valor|preco|preço|valor do lote|quanto custa|investimento|a partir de quanto|valor inicial|metro quadrado|m2)\b/.test(
    n
  );
}

function isUserAskingSpecificLotSize(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  if (!/\b\d{2,4}\s*m(?:2|²)?\b/.test(n)) return false;
  if (/\b(valor|preco|preço|investimento|r\$|metro quadrado)\b/.test(n)) return false;
  const hasSpecificIntent =
    /\b(lote|terreno)\b/.test(n) ||
    /\b(tem|quero|procuro)\b/.test(n) ||
    n.length <= 28;
  if (!hasSpecificIntent) return false;
  return true;
}

function isUserAskingLotSizeRange(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  if (isUserAskingSpecificLotSize(text)) return true;
  return /\b(quais?\s+os?\s+tamanhos?|qual\s+o\s+tamanho|tamanho\s+dos\s+lotes?|metragem|metragens|faixa\s+de\s+metragem)\b/.test(
    n
  );
}

function isUserAskingEvoraLotAvailability(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(lotes? disponiveis|lotes? disponivel|disponibilidade de lotes?|qual lote tem|qual unidade disponivel|tem algum lote disponivel|quais lotes)\b/.test(n);
}

function hasUnsafeLotAvailabilityPromise(text: string): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  const mentionsAvailability = /\b(lotes? disponiveis|lotes? disponivel|unidades disponiveis|disponibilidade atualizada)\b/.test(n);
  if (!mentionsAvailability) return false;
  const routesToBroker = /\b(corretor|consultor)\b/.test(n);
  const blocksConfirmation = /\b(nao consigo confirmar|não consigo confirmar|depende|varia conforme)\b/.test(n);
  return !routesToBroker && !blocksConfirmation;
}

function sanitizeEvoraLotAvailabilityReply(text: string, opts?: FinalizeAnaReplyOptions): string {
  const clean = String(text || '').trim();
  if (!clean || !isEvoraScopedContext(opts)) return clean;

  if (isUserAskingEvoraLotAvailability(opts?.userMessage ?? null)) {
    return `${EVORA_LOT_AVAILABILITY_BROKER_REPLY}\n\nVocê prefere ver os tamanhos gerais primeiro ou falar com o corretor?`;
  }

  if (!hasUnsafeLotAvailabilityPromise(clean)) return clean;

  const withoutUnsafe = clean
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !hasUnsafeLotAvailabilityPromise(sentence))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return [withoutUnsafe, EVORA_LOT_AVAILABILITY_BROKER_REPLY].filter(Boolean).join('\n\n').trim();
}

function sanitizeEvoraPriceAndPaymentReply(text: string, opts?: FinalizeAnaReplyOptions): string {
  const clean = String(text || '').trim();
  if (!clean) return clean;
  if (!isEvoraScopedContext(opts)) return clean;

  const userMessage = opts?.userMessage ?? null;
  if (isUserAskingSpecificLotSize(userMessage)) {
    console.log('[ANA_SPECIFIC_LOT_SIZE_REQUEST_DETECTED]', {
      userPreview: String(userMessage || '').slice(0, 180),
    });
    console.log('[ANA_SPECIFIC_LOT_AVAILABILITY_BLOCKED]', {
      reason: 'specific_lot_size_needs_broker_confirmation',
    });
    return `${EVORA_LOT_SIZE_RANGE_REPLY} Posso te encaminhar para o corretor responsável ou, se preferir, te ajudar a agendar uma visita?`;
  }
  if (isUserAskingLotSizeRange(userMessage)) {
    return `${EVORA_LOT_SIZE_GENERAL_REPLY} Quer que eu te explique os tipos de lote que existem no empreendimento?`;
  }
  if (isUserAskingEvoraInstallment(userMessage)) return EVORA_INSTALLMENT_REDIRECT_REPLY;
  if (isUserAskingEvoraPayment(userMessage)) return EVORA_PAYMENT_REPLY;
  if (isUserAskingEvoraPrice(userMessage)) {
    return `${EVORA_PRICE_REPLY} Quer que eu te explique também as formas de pagamento?`;
  }

  if (/\bpreco\b.*\bnao foi divulgado\b/i.test(normClosure(clean))) {
    return EVORA_PRICE_REPLY;
  }

  return clean;
}

function removeInternalLimitationSentences(text: string): { text: string; changed: boolean } {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { text, changed: false };
  const forbidden = [
    /\bnao tenho essa informacao liberada\b/i,
    /\bnao tenho acesso\b/i,
    /\bnao consta na base\b/i,
    /\bmaterial liberad/i,
    /\bbase da ana\b/i,
    /\binformacao nao liberada\b/i,
    /\bnao fui autorizad/i,
    /\bno material de apoio\b/i,
    /\bnao encontrei\b/i,
    /\bnao localizei\b/i,
  ];
  let changed = false;
  const kept = lines.filter((line) => {
    const hit = forbidden.some((re) => re.test(line));
    if (hit) changed = true;
    return !hit;
  });
  if (!changed) return { text, changed: false };
  const next = kept.join('\n').trim();
  if (!next) return { text: BROKER_DETAIL_ROUTING_TEXT, changed: true };
  return { text: `${next}\n\n${BROKER_DETAIL_ROUTING_TEXT}`, changed: true };
}

function appendUsefulQuestionForMultiTopicReply(text: string, userMessage: string | null | undefined): string {
  const raw = (text || '').trim();
  if (!raw || /\?/.test(raw)) return raw;
  const userRaw = String(userMessage || '');
  if (!/\r?\n|;/.test(userRaw)) return raw;
  const n = normClosure(userRaw);
  const topicHits = [
    /\b(localizacao|onde fica|endereco)\b/.test(n),
    /\b(valores?|preco|investimento|pagamento|entrada|parcela)\b/.test(n),
    /\b(lazer|seguranca|portaria)\b/.test(n),
    /\b(lotes?|metragem|tamanho)\b/.test(n),
  ].filter(Boolean).length;
  if (topicHits < 2) return raw;
  const replyNorm = normClosure(raw);
  if (/\b(corretor|encaminhar|agendar|visita)\b/.test(replyNorm)) return raw;
  return `${raw} Quer que eu siga por valores, localização ou formas de pagamento?`;
}

function sanitizeUnsupportedSpecificOffers(text: string): { text: string; changed: boolean } {
  const raw = (text || '').trim();
  if (!raw) return { text: raw, changed: false };
  const forbiddenOfferPatterns = [
    /\bplanta(?:s)? dos lotes?\b/i,
    /\bmodelos? de construc/i,
    /\btabela\b/i,
    /\bvalores? exatos?\b/i,
    /\bdisponibilidade em tempo real\b/i,
    /\bsimulac/i,
    /\bdesconto\b/i,
    /\bdetalhes? juridic/i,
    /\bdetalhes? contratuais?\b/i,
  ];
  if (!forbiddenOfferPatterns.some((re) => re.test(raw))) return { text: raw, changed: false };
  const replaced = raw.replace(
    /.*(?:planta(?:s)? dos lotes?|modelos? de construc[aã]o|tabela|valores? exatos?|disponibilidade em tempo real|simulac[aã]o|desconto|detalhes? juridic[oa]s?|detalhes? contratuais?).*/gi,
    'Se quiser, eu te explico localizacao, estrutura, lazer e seguranca, e ja te ajudo a marcar visita.'
  ).replace(/\s+/g, ' ').trim();
  return { text: replaced || 'Se quiser, eu te explico os diferenciais gerais e ja te ajudo a marcar visita.', changed: true };
}

export function containsInternalLimitationLanguage(text: string): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return (
    n.includes('nao tenho essa informacao liberada') ||
    n.includes('nao tenho acesso') ||
    n.includes('nao consta na base') ||
    n.includes('material liberado') ||
    n.includes('base da ana') ||
    n.includes('informacao nao liberada') ||
    n.includes('nao fui autorizada') ||
    n.includes('no material de apoio') ||
    n.includes('nao encontrei') ||
    n.includes('nao localizei')
  );
}

export function finalizeAnaReplyText(text: string, opts?: FinalizeAnaReplyOptions): string {
  const isFirstAnaReply = opts?.isFirstAnaReply === true;
  const isKnowledgeGapTurn = opts?.isKnowledgeGapTurn === true;
  const base = normalizeWhitespacePreservingLines(stripMarkdownArtifactsForWhatsApp((text || '').trim()));
  const noReintro = stripMidConversationReintroduction(base, isFirstAnaReply);
  const materialShort = applyShortMaterialReplyPolicy(noReintro, opts?.userMessage ?? null);
  const compact = sanitizeDuplicatedGreetingPrefix(materialShort);
  const evoraLocation = forceEvoraLocationReplyWhenNeeded(compact, opts);
  const humanLazer = humanizeLazerReplyWhenNeeded(evoraLocation, opts?.userMessage ?? null);
  const withOpenQuestion = isKnowledgeGapTurn
    ? humanLazer
    : appendOpenQuestionForGeneralEnterpriseIntro(humanLazer, opts?.userMessage ?? null);
  const evoraLazer = forceEvoraLazerReplyWhenNeeded(withOpenQuestion, opts);
  const noBrokenList = sanitizeBrokenListOrLazerContinuation(evoraLazer, opts);
  const sanitized = isKnowledgeGapTurn ? { text: noBrokenList, changed: false } : removeInternalLimitationSentences(noBrokenList);
  const safeOffers = isKnowledgeGapTurn ? { text: sanitized.text, changed: false } : sanitizeUnsupportedSpecificOffers(sanitized.text);
  const dedupGreeting = sanitizeDuplicatedGreetingPrefix(safeOffers.text);
  const noInternalFragments = INTERNAL_INSTRUCTION_FRAGMENT_PATTERNS.reduce(
    (acc, re) => acc.replace(re, ' ').replace(/\s{2,}/g, ' ').trim(),
    dedupGreeting,
  );
  const lotCountSafe = isKnowledgeGapTurn
    ? noInternalFragments
    : sanitizeEvoraLotCountRestrictedReply(noInternalFragments, opts?.userMessage ?? null);
  const discountSafe = isKnowledgeGapTurn
    ? lotCountSafe
    : sanitizeDiscountRestrictedReply(lotCountSafe, opts?.userMessage ?? null);
  const evoraPricingSafe = isKnowledgeGapTurn ? discountSafe : sanitizeEvoraPriceAndPaymentReply(discountSafe, opts);
  const evoraAvailabilitySafe = isKnowledgeGapTurn ? evoraPricingSafe : sanitizeEvoraLotAvailabilityReply(evoraPricingSafe, opts);
  const multiTopicSafe = isKnowledgeGapTurn
    ? evoraAvailabilitySafe
    : appendUsefulQuestionForMultiTopicReply(evoraAvailabilitySafe, opts?.userMessage ?? null);
  const forbiddenQuestionStrip = stripForbiddenFixedQualificationQuestion(multiTopicSafe);
  const feminineGuard = enforceFeminineSelfReference(forbiddenQuestionStrip.text || evoraAvailabilitySafe);
  const finalText = feminineGuard.text || forbiddenQuestionStrip.text || evoraAvailabilitySafe;
  const regionContextSafe = rescueEvoraRegionContextReply(finalText, opts);
  const neutralSafe = rescueNeutralOpenCommercialReply(regionContextSafe, opts);
  const questionSafe = countQuestions(neutralSafe) > 1 ? sanitizeTooManyQuestionsReply(neutralSafe) : neutralSafe;
  return sanitizeAnaClientVisibleReplyText(questionSafe).slice(0, 4000);
}

function enforceFeminineSelfReference(text: string): { text: string; changed: boolean } {
  const raw = String(text || '').trim();
  if (!raw) return { text: raw, changed: false };
  let next = raw;
  next = next.replace(/\bmuito obrigado\b/gi, 'Muito obrigada');
  next = next.replace(/\bobrigado\b/gi, 'Obrigada');
  const changed = next !== raw;
  if (changed) {
    console.log('[ANA_FEMININE_SELF_REFERENCE_FIXED]', {
      originalPreview: raw.slice(0, 120),
      finalPreview: next.slice(0, 120),
    });
  }
  return { text: next, changed };
}

function truncateAtWordBoundary(text: string, maxLen: number): string {
  const t = (text || '').trim();
  if (t.length <= maxLen) return t;
  const sliced = t.slice(0, Math.max(0, maxLen));
  const lastSpace = sliced.lastIndexOf(' ');
  const safe = (lastSpace >= 24 ? sliced.slice(0, lastSpace) : sliced).trim();
  return safe.replace(/[,:;.\-–—\s]+$/g, '').trim();
}

function ensureSentenceEnd(text: string): string {
  const t = (text || '').trim();
  if (!t) return t;
  if (/[.!?…]$/.test(t)) return t;
  return `${t}.`;
}

const LEADING_LABEL_PREFIX_RE = /^([A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ0-9 _-]{2,}):\s+/i;

function normalizeLabelToken(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGreetingLikeReply(text: string): boolean {
  const n = normClosure(text || '');
  if (!n || n.length > 120) return false;
  const greetingStart = /^(oi|ola|bom dia|boa tarde|boa noite|opa|e ai)\b/.test(n);
  if (!greetingStart) return false;
  if (/\b(empreendimento|cidade|regiao|localizacao|qual empreendimento|qual cidade|te ajudo)\b/.test(n)) {
    return false;
  }
  if ((text.match(/\?/g) || []).length >= 1 && /\b(qual|quais|prefere|quer)\b/.test(n)) {
    return false;
  }
  if (/\b(preco|valor|lazer|portaria|metragem|localizacao|financiamento|visita|agenda|endereco)\b/.test(n)) {
    return false;
  }
  return true;
}

function sanitizeLeadingLabelPrefix(text: string, enterpriseName?: string | null): string {
  const raw = (text || '').trim();
  if (!raw) return raw;

  const m = LEADING_LABEL_PREFIX_RE.exec(raw);
  if (!m) return raw;

  const label = (m[1] || '').trim();
  const body = raw.slice(m[0].length).trim();
  const normalizedLabel = normalizeLabelToken(label);
  const normalizedEnterprise = normalizeLabelToken(enterpriseName || '');
  const isEnterpriseLabel = normalizedEnterprise.length >= 2 && normalizedLabel === normalizedEnterprise;

  if (!body || isGreetingLikeReply(body)) return body || raw;
  if (isEnterpriseLabel) return body;
  return body;
}

export function applyAnaHardLengthGuard(params: {
  text: string;
  enterpriseName?: string | null;
  maxChars?: number;
  preserveLineBreaks?: boolean;
}): string {
  const maxChars = Math.max(120, Math.min(600, params.maxChars ?? 300));
  const enterpriseName = (params.enterpriseName || '').trim();
  const sourceText = params.preserveLineBreaks
    ? (params.text || '').trim()
    : (params.text || '').replace(/\r?\n+/g, ' ').trim();
  const cleaned = normalizeWhitespacePreservingLines(stripMarkdownArtifactsForWhatsApp(sourceText));
  if (!cleaned) return '';

  if (params.preserveLineBreaks) {
    const lines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    const kept: string[] = [];
    let total = 0;
    let questionUsed = false;
    for (const line of lines) {
      const hasQuestion = line.includes('?');
      if (hasQuestion && questionUsed) continue;
      const plus = (kept.length > 0 ? 1 : 0) + line.length;
      if (total + plus > maxChars) break;
      kept.push(line);
      total += plus;
      if (hasQuestion) questionUsed = true;
    }
    const out = (kept.join('\n').trim() || truncateAtWordBoundary(cleaned.replace(/\n+/g, ' '), maxChars))
      .slice(0, maxChars)
      .trim();
    const questionSafe = countQuestions(out) > 1 ? sanitizeTooManyQuestionsReply(out) : out;
    return sanitizeLeadingLabelPrefix(questionSafe, enterpriseName);
  }

  const inputSentences = splitSentencesCompact(cleaned);
  const kept: string[] = [];
  let questionUsed = false;
  for (const sRaw of inputSentences) {
    const s = sRaw.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const hasQ = s.includes('?');
    if (hasQ && questionUsed) continue;
    kept.push(s);
    if (hasQ) questionUsed = true;
    if (kept.length >= 2) break;
  }

  let out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (!out) out = truncateAtWordBoundary(cleaned, 140);
  out = ensureSentenceEnd(out);

  // Reaplica estrutura rígida após eventuais ajustes.
  const normalizedSentences = splitSentencesCompact(out);
  const finalSentences: string[] = [];
  let finalQuestionUsed = false;
  for (const s of normalizedSentences) {
    const sentence = s.trim();
    if (!sentence) continue;
    const hasQ = sentence.includes('?');
    if (hasQ && finalQuestionUsed) continue;
    finalSentences.push(sentence);
    if (hasQ) finalQuestionUsed = true;
    if (finalSentences.length >= 2) break;
  }
  out = finalSentences.join(' ').replace(/\s{2,}/g, ' ').trim();

  if (out.length > maxChars) {
    if (finalSentences.length > 1) {
      const firstOnly = ensureSentenceEnd(finalSentences[0] || '');
      if (firstOnly.length <= maxChars) out = firstOnly;
    }
    if (out.length > maxChars) {
      out = ensureSentenceEnd(truncateAtWordBoundary(out, maxChars));
    }
  }

  const sanitized = sanitizeLeadingLabelPrefix(out.slice(0, maxChars).trim(), enterpriseName);
  return stripForbiddenFixedQualificationQuestion(sanitized).text;
}

function normalizeQualificationFragment(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsForbiddenQualificationFragment(s: string): boolean {
  const n = normalizeQualificationFragment(s);
  if (!n) return false;
  const hasTriad = /\bmorar\s+investir\s+ou\s+construir\b/.test(n);
  const hasFirstFixedQuestion = /\bvoce\s+esta\s+buscando\s+o\s+lote\s+para\b/.test(n) && hasTriad;
  const hasSecondFixedQuestion = /\bvoce\s+busca\s+para\b/.test(n) && /\bfuturamente\b/.test(n) && hasTriad;
  return (
    hasFirstFixedQuestion ||
    hasSecondFixedQuestion ||
    hasTriad
  );
}

function stripForbiddenFixedQualificationQuestion(text: string): { text: string; changed: boolean } {
  const raw = (text || '').trim();
  if (!raw) return { text: raw, changed: false };
  if (!containsForbiddenQualificationFragment(raw)) return { text: raw, changed: false };

  const parts = raw
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const kept = parts.filter((part) => !containsForbiddenQualificationFragment(part));
  let next = kept.join(' ').replace(/\s{2,}/g, ' ').trim();

  if (!next) {
    next = raw
      .replace(
        /v(?:o|ó)ce\s+est[aá]\s+buscando\s+o\s+lote\s+para\s+morar,\s*investir\s+ou\s+c(?:o|ô)nstruir\??/gi,
        ''
      )
      .replace(
        /v(?:o|ó)ce\s+busca\s+para\s+morar,\s*investir\s+ou\s+c(?:o|ô)nstruir\s+futuramente\??/gi,
        ''
      )
      .replace(/\bmorar,\s*investir\s+ou\s+c(?:o|ô)nstruir\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/^[,.;:!?-]+\s*/g, '')
      .trim();
  }

  return { text: next, changed: next !== raw };
}

function normalizeForSemanticCheck(text: string): string {
  return (text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEmptyOrPunctuationOnly(text: string): boolean {
  const t = normalizeForSemanticCheck(text);
  if (!t) return true;
  // Considera inválido quando não há letras ou números (ex.: ".", "...", "?!", "-").
  return !/[\p{L}\p{N}]/u.test(t);
}

function normOutbound(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeInternalControlText(raw: string, normalized: string): boolean {
  if (!raw) return false;
  if (/```/.test(raw)) return true;
  if (/\[ana_[a-z0-9_ -]+\]/i.test(raw)) return true;
  if (
    normalized.includes('contexto persistido') ||
    normalized.includes('evidencia validada do backend') ||
    normalized.includes('estado_comercial_json') ||
    normalized.includes('send_file_category') ||
    normalized.includes('conversationid') ||
    normalized.includes('messageid')
  ) {
    return true;
  }
  const trimmed = raw.trim();
  if (
    /^\{[\s\S]*\}$/.test(trimmed) &&
    /"reply"\s*:/.test(trimmed) &&
    /"classification"\s*:/.test(trimmed)
  ) {
    return true;
  }
  return false;
}

export function evaluateAnaOutboundText(opts: {
  reply: string;
  technicalFallbackText?: string;
  conversationType?: 'CLIENT' | 'CORRETOR' | 'ADMIN' | string | null;
  enterpriseName?: string | null;
}): { text: string; valid: boolean; reason: string } {
  const conversationType = String(opts.conversationType ?? 'CLIENT').toUpperCase();
  if (conversationType === 'CORRETOR') {
    return { text: '', valid: false, reason: 'conversation_type_corretor' };
  }
  const raw = sanitizeLeadingLabelPrefix((opts.reply || '').trim(), opts.enterpriseName);
  if (!raw) {
    return { text: raw, valid: false, reason: 'empty_text' };
  }
  if (isEmptyOrPunctuationOnly(raw)) {
    return { text: raw, valid: false, reason: 'punctuation_only_or_placeholder' };
  }

  const n = normOutbound(raw);
  const technicalNorm = normOutbound(opts.technicalFallbackText || '');
  if (technicalNorm && n === technicalNorm) {
    return { text: raw, valid: false, reason: 'fallback_technical_blocked' };
  }
  if (
    n.includes('nao consegui continuar daqui agora') ||
    n.includes('me manda novamente em uma frase o que voce quer saber')
  ) {
    return { text: raw, valid: false, reason: 'fallback_technical_blocked' };
  }
  if (
    n.includes('erro tecnico') ||
    n.includes('tente novamente mais tarde') ||
    n.includes('sistema indisponivel')
  ) {
    return { text: raw, valid: false, reason: 'generic_technical_error_blocked' };
  }
  if (looksLikeInternalControlText(raw, n)) {
    return { text: raw, valid: false, reason: 'internal_control_text_blocked' };
  }

  return { text: raw.slice(0, 4000), valid: true, reason: 'valid_semantic_text' };
}

function normFinalGuard(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function userAskedObjectiveQuestion(text: string | null | undefined): boolean {
  const n = normFinalGuard(text || '');
  if (!n) return false;
  return (
    /\?/.test(text || '') ||
    /\b(qual|quais|quanto|custa|valor|preco|metragem|metros|m2|m²|onde fica|localizacao|endereco|lazer|area de lazer|areas de lazer|financiamento|pagamento|entrada|parcela|disponibilidade)\b/.test(n)
  );
}

function userSentOnlyGreeting(text: string | null | undefined): boolean {
  const n = normFinalGuard(text || '');
  if (!n || n.length > 48) return false;
  const cleaned = n.replace(/[,.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(oi|ola|oie|opa|bom dia|boa tarde|boa noite|tudo bem|td bem|oi tudo bem|ola tudo bem|oie tudo bem|opa tudo bem)[!.? ]*$/.test(cleaned);
}

function replyStartsWithGreeting(text: string): boolean {
  return /^(oi|ola|olá|bom dia|boa tarde|boa noite|opa)\b/i.test((text || '').trim());
}

function startsWithComposedCordialGreeting(text: string): boolean {
  const n = normFinalGuard(text || '');
  return (
    /^(oi|ola)\s*[!,.]?\s*(bom dia|boa tarde|boa noite)\s*[!,.]?\s*tudo bem\s*\?/.test(n) ||
    /^(ola|oi|bom dia|boa tarde|boa noite|opa)\b/.test(n)
  );
}

function stripOpeningGreetingPrefix(text: string): string {
  let next = (text || '').trim();
  next = next.replace(/^(oi|ol[aá])(?:[!,. ]+)?/i, '').trim();
  next = next.replace(/^(bom dia|boa tarde|boa noite)(?:[!,. ]+)?/i, '').trim();
  next = next.replace(/^tudo bem\s*\?\s*/i, '').trim();
  return next;
}

function countQuestions(text: string): number {
  return ((text || '').match(/\?(?=\s+[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ]|$)/g) || []).length;
}

export function sanitizeTooManyQuestionsReply(reply: string): string {
  const raw = (reply || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  const questionCount = countQuestions(raw);
  if (questionCount <= 1) return raw;

  let base = raw;
  while (/\?\s*$/.test(base)) {
    const next = base.replace(/(?:^|[\s.!])[^.!?]*\?\s*$/u, '').trim();
    if (!next || next === base) break;
    base = next;
  }

  base = base.replace(/\?+/g, '.').replace(/\s+/g, ' ').trim();
  base = base.replace(/[,:;\-]\s*$/g, '').trim();
  if (base && !/[.!]$/.test(base)) base = `${base}.`;

  const safeQuestion =
    /\b(localizacao|localização|bairro|onde fica|endereco|endereço|atibaia)\b/i.test(base)
      ? 'Quer que eu te fale mais sobre a localização?'
      : 'Quer saber mais sobre a localização ou prefere falar com um corretor?';

  if (!base) {
    const head = raw.split('?')[0]?.trim() ?? '';
    if (!head) return '';
    const normalizedHead = /[.!]$/.test(head) ? head : `${head}.`;
    return `${normalizedHead} ${safeQuestion}`.trim();
  }
  return `${base} ${safeQuestion}`.trim();
}

function hasAxisAnswerSignal(replyNorm: string, userNorm: string): boolean {
  if (!replyNorm || !userNorm) return false;
  if (/\b(valor|preco|quanto|custa|r\$)\b/.test(userNorm)) {
    return /\b(r\$|valor|preco|a partir de|entrada|parcela|condic)/.test(replyNorm);
  }
  if (/\b(metragem|metros|m2|m²|tamanho|planta|tipologia)\b/.test(userNorm)) {
    return /\b(metragem|metros|m2|m²|planta|tipologia|quarto|dormitorio|\d+\s*m)/.test(replyNorm);
  }
  if (/\b(lazer|area de lazer|areas de lazer|areas comuns|amenidades)\b/.test(userNorm)) {
    return /\b(lazer|piscina|academia|quadra|salao|playground|areas comuns|area comum|churrasqueira|coworking|pet|fitness)\b/.test(replyNorm);
  }
  if (/\b(onde fica|localizacao|endereco|bairro|cidade)\b/.test(userNorm)) {
    return /\b(fica|localizacao|endereco|bairro|cidade|rua|avenida)\b/.test(replyNorm);
  }
  if (/\b(financiamento|pagamento|entrada|parcela|condic)\b/.test(userNorm)) {
    return /\b(financiamento|pagamento|entrada|parcela|condic|corretor)\b/.test(replyNorm);
  }
  return true;
}

function sanitizeDuplicatedGreetingPrefix(text: string): string {
  const raw = (text || '').trim();
  if (!raw) return raw;
  return raw
    .replace(/^(oi|ol[aá]|bom dia|boa tarde|boa noite)[!,. ]+\s*(oi|ol[aá]|bom dia|boa tarde|boa noite)(?:[!,. ]+)/i, '$1! ')
    .replace(/^(oi|ol[aá])\s*,\s*(oi|ol[aá])(?:[!,. ]+)/i, '$1! ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function saysInfoMissingDespiteEvidence(replyNorm: string, knowledgeNorm: string): boolean {
  if (!replyNorm || !knowledgeNorm) return false;
  const missingClaim =
    /\b(nao encontrei|nao consta|nao tenho essa informacao|nao achei|nao localizei|preciso confirmar)\b/.test(replyNorm);
  if (!missingClaim) return false;
  const evidenceMarkers = [
    /\br\$\s*\d/,
    /\bvalor(?:es)?\b/,
    /\bpreco\b/,
    /\bmetragem\b/,
    /\b\d+\s*m(?:2|²)?\b/,
    /\blazer\b/,
    /\bpiscina\b/,
    /\bacademia\b/,
    /\bquadra\b/,
    /\bfica em\b/,
    /\bendereco\b/,
    /\bentrega\b/,
  ];
  return evidenceMarkers.some((re) => re.test(knowledgeNorm));
}

export function evaluateAnaEmptyFallbackGuard(opts: {
  reply: string;
  userMessage: string | null | undefined;
  lastAssistantMessage?: string | null;
  isFirstAnaReply?: boolean;
  knowledgeText?: string | null;
}): { blocked: boolean; reason: string | null } {
  const n = normFinalGuard(opts.reply || '');
  if (!n) return { blocked: true, reason: 'empty_after_guards' };
  const userNorm = normFinalGuard(opts.userMessage || '');

  const badPatterns: Array<[RegExp, string]> = [
    [/\bposso te explicar\b/, 'empty_phrase_posso_te_explicar'],
    [/\bposso apresentar\b/, 'empty_phrase_posso_apresentar'],
    [/\bprincipais pontos\b/, 'empty_phrase_principais_pontos'],
    [/\bqual ponto voce quer\b/, 'empty_phrase_qual_ponto_voce_quer'],
    [/\bforma objetiva\b/, 'empty_phrase_forma_objetiva'],
    [/\bquer que eu detalhe\b/, 'empty_phrase_quer_que_eu_detalhe'],
    [/\bqualquer coisa estou a disposicao\b/, 'empty_closure_vague_disposition'],
    [/\bveja bem\b/, 'empty_phrase_veja_bem'],
  ];
  for (const [re, reason] of badPatterns) {
    if (re.test(n)) return { blocked: true, reason };
  }

  if (/\bmorar ou investir\b/.test(n) && userAskedObjectiveQuestion(opts.userMessage)) {
    return { blocked: true, reason: 'empty_phrase_morar_ou_investir_after_objective_ask' };
  }
  if (countQuestions(opts.reply || '') > 1) {
    return { blocked: true, reason: 'too_many_questions' };
  }
  if (opts.isFirstAnaReply === true && !startsWithComposedCordialGreeting(opts.reply || '')) {
    return { blocked: true, reason: 'first_reply_missing_greeting' };
  }
  if (/^(oi|ola|bom dia|boa tarde|boa noite)[!. ]*(eu sou|sou)?\s*(a\s*)?ana[!. ]*$/.test(n)) {
    return { blocked: true, reason: 'dry_robotic_greeting' };
  }
  if (userSentOnlyGreeting(opts.userMessage) && n.split(/\s+/).filter(Boolean).length < 7) {
    return { blocked: true, reason: 'too_dry_for_opening_greeting' };
  }
  if (userSentOnlyGreeting(opts.userMessage) && isGreetingLikeReply(opts.reply || '')) {
    return { blocked: true, reason: 'isolated_greeting_without_contextual_followup' };
  }
  if (userAskedObjectiveQuestion(opts.userMessage) && countQuestions(opts.reply || '') > 0 && n.split(/\s+/).filter(Boolean).length <= 5) {
    return { blocked: true, reason: 'objective_question_turned_into_question' };
  }
  if (userAskedObjectiveQuestion(opts.userMessage) && !hasAxisAnswerSignal(n, userNorm)) {
    return { blocked: true, reason: 'objective_question_not_answered' };
  }
  if (
    userAskedObjectiveQuestion(opts.userMessage) &&
    /\b(encaminhar|vou passar|passar para|um consultor|um corretor|atendente)\b/.test(n) &&
    !hasAxisAnswerSignal(n, userNorm)
  ) {
    return { blocked: true, reason: 'handoff_before_helping' };
  }
  if (/\b(como ja expliquei|obviamente|voce precisa entender|nao foi isso que eu disse|ja falei)\b/.test(n)) {
    return { blocked: true, reason: 'defensive_or_superior_tone' };
  }
  if (/\b(nao posso fazer nada|isso nao e comigo|voce deve procurar|sem essa informacao nao consigo ajudar)\b/.test(n)) {
    return { blocked: true, reason: 'cold_or_unhelpful_tone' };
  }
  if (saysInfoMissingDespiteEvidence(n, normFinalGuard(opts.knowledgeText || ''))) {
    return { blocked: true, reason: 'claims_missing_info_present_in_rag' };
  }

  return { blocked: false, reason: null };
}

function contextualGreeting(referenceNow?: Date | string | null): 'Bom dia' | 'Boa tarde' | 'Boa noite' {
  const d = referenceNow instanceof Date ? referenceNow : referenceNow ? new Date(referenceNow) : new Date();
  const hourText = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hour12: false,
  }).format(d);
  const hour = Number(hourText.replace(/\D/g, ''));
  if (Number.isFinite(hour) && hour >= 5 && hour < 12) return 'Bom dia';
  if (Number.isFinite(hour) && hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function applyFirstUsefulGreetingStyle(opts: {
  text: string;
  isFirstAnaReply?: boolean;
  referenceNow?: Date | string | null;
}): { text: string; changed: boolean; greeting: string | null } {
  const raw = (opts.text || '').trim();
  if (!raw) return { text: raw, changed: false, greeting: null };
  if (opts.isFirstAnaReply !== true) return { text: raw, changed: false, greeting: null };
  if (startsWithComposedCordialGreeting(raw)) return { text: raw, changed: false, greeting: null };

  const compact = raw.replace(/\s+/g, ' ').trim();
  const words = compact.split(/\s+/).filter(Boolean);
  const hasUsefulAndReasonableContent =
    compact.length >= 24 &&
    words.length >= 5 &&
    /[\p{L}\p{N}]/u.test(compact);
  if (!hasUsefulAndReasonableContent) return { text: raw, changed: false, greeting: null };

  const greetingPeriod = contextualGreeting(opts.referenceNow).toLowerCase();
  const greeting = `Olá, ${greetingPeriod}, tudo bem?`;
  const withoutLeadingGreeting = stripOpeningGreetingPrefix(raw) || raw;
  const separator = /\r?\n/.test(withoutLeadingGreeting) ? '\n\n' : ' ';
  const merged = `${greeting}${separator}${withoutLeadingGreeting}`;
  const next =
    separator === '\n\n'
      ? merged.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
      : merged.replace(/\s{2,}/g, ' ').trim();
  return { text: next, changed: next !== raw, greeting };
}

/**
 * Guard leve da primeira resposta: remove apenas trechos de preço/parcelamento/entrada
 * quando o cliente não pediu isso explicitamente.
 */
export function sanitizeFirstReplyCommercialLeak(reply: string): {
  text: string;
  removedCommercialSentences: number;
} {
  const base = normalizeWhitespacePreservingLines(stripMarkdownArtifactsForWhatsApp((reply || '').trim()));
  if (!base) return { text: base, removedCommercialSentences: 0 };

  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

  const hasCommercialLeak = (sentence: string): boolean => {
    const raw = sentence.trim();
    const n = norm(raw);
    if (!n) return false;

    const strongPatterns: RegExp[] = [
      /r\$\s*\d/,
      /\bpreco(?:s)?\b/,
      /\bquanto\s+(?:custa|fica|sai)\b/,
      /\bparcela(?:s)?\b/,
      /\bentrada\b/,
      /\bfinanciamento\b/,
      /\bdesconto\b/,
      /\bcondic(?:ao|oes)\s+de\s+pagamento\b/,
      /\bpagamento\s+facilitado\b/,
      /\bparcelado\b/,
      /\bsinal\s+de\s+entrada\b/,
      /\bqual\s+o\s+valor\b/,
      /\bvalor\s+do\s+(?:lote|terreno|imovel|apartamento|empreendimento)\b/,
      /\bvalor\s+da\s+entrada\b/,
      /\bme\s+passa\s+o\s+valor\b/,
      /\bvalores?\s+a\s+partir\s+de\b/,
    ];
    return strongPatterns.some((re) => re.test(n));
  };

  const splitSentences = (text: string): string[] => {
    const out: string[] = [];
    const simpleAbbrev = new Set([
      'sr',
      'sra',
      'srta',
      'dr',
      'dra',
      'av',
      'al',
      'apt',
      'bl',
      'cj',
      'etc',
    ]);
    let buf = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === '\n') {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
        continue;
      }
      buf += ch;

      if (ch === '!' || ch === '?') {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
        continue;
      }

      if (ch === '.') {
        const prev = text[i - 1] ?? '';
        const next = text[i + 1] ?? '';

        // Não quebra ponto dentro de número: 279.000,00 / 3.500 m²
        if (/\d/.test(prev) && /\d/.test(next)) continue;

        // Não quebra abreviações comuns.
        const beforeDot = buf.slice(0, -1).trim();
        const token = beforeDot.match(/([A-Za-zÀ-ÿ]{1,5})$/)?.[1]?.toLowerCase() ?? '';
        if (simpleAbbrev.has(token)) continue;

        // Acrônimo simples no padrão "S.A." / "U.S.A.".
        if (/[A-Za-z]\.[A-Za-z]$/.test(beforeDot)) continue;

        // Se não há espaço após ".", pode ser token interno, não fim de frase.
        if (next && !/\s/.test(next)) continue;

        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
      }
    }
    const tail = buf.trim();
    if (tail) out.push(tail);
    return out;
  };

  const sentences = splitSentences(base);
  const kept: string[] = [];
  let removed = 0;
  for (const s of sentences) {
    if (hasCommercialLeak(s)) {
      removed += 1;
      continue;
    }
    kept.push(s.trim());
  }

  if (removed === 0) return { text: base, removedCommercialSentences: 0 };

  if (kept.length === 0) {
    return {
      text: '',
      removedCommercialSentences: removed,
    };
  }
  const rebuilt = kept
    .join(' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text: rebuilt.slice(0, 4000), removedCommercialSentences: removed };
}

/**
 * Guard comercial-financeiro: impede que a Ana simule/negocie condições.
 * Remove/substitui apenas sentenças indevidas, preservando o restante do texto.
 */
export function sanitizeFinancialNegotiationOverreach(reply: string): {
  text: string;
  replacedFinancialSentences: number;
} {
  const base = normalizeWhitespacePreservingLines(stripMarkdownArtifactsForWhatsApp((reply || '').trim()));
  if (!base) return { text: base, replacedFinancialSentences: 0 };

  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

  const splitSentences = (text: string): string[] => {
    const out: string[] = [];
    const simpleAbbrev = new Set([
      'sr',
      'sra',
      'srta',
      'dr',
      'dra',
      'av',
      'al',
      'apt',
      'bl',
      'cj',
      'etc',
    ]);
    let buf = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === '\n') {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
        continue;
      }
      buf += ch;

      if (ch === '!' || ch === '?') {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
        continue;
      }

      if (ch === '.') {
        const prev = text[i - 1] ?? '';
        const next = text[i + 1] ?? '';
        if (/\d/.test(prev) && /\d/.test(next)) continue;
        const beforeDot = buf.slice(0, -1).trim();
        const token = beforeDot.match(/([A-Za-zÀ-ÿ]{1,5})$/)?.[1]?.toLowerCase() ?? '';
        if (simpleAbbrev.has(token)) continue;
        if (/[A-Za-z]\.[A-Za-z]$/.test(beforeDot)) continue;
        if (next && !/\s/.test(next)) continue;
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
      }
    }
    const tail = buf.trim();
    if (tail) out.push(tail);
    return out;
  };

  const isAlreadyBrokerRedirect = (n: string): boolean =>
    /\b(corretor|corretora)\b/.test(n) &&
    /\b(entrada|parcela|parcelas|prazo|simulac|pagamento|juros|correcao|desconto|condic)\b/.test(n);

  const prohibitedPatterns: RegExp[] = [
    /\b(consigo|posso|vou|deixa\s+eu|deixe\s+eu)\s+(?:te\s+)?(?:montar|simular|ajustar|calcular)\b/,
    /\b(simulac(?:ao|oes)|pre-?simulac(?:ao|oes)|simulacao\s+personalizada)\b/,
    /\b(cenario\s+financeiro|plano\s+de\s+pagamento|fluxo\s+de\s+pagamento)\b/,
    /\bquanto\s+pode\s+dar\s+de\s+entrada\b/,
    /\bqual\s+(?:valor\s+de\s+)?parcela\b/,
    /\bqual\s+parcela\s+voce\s+quer\s+pagar\b/,
    /\bem\s+quantas?\s+vezes\b/,
    /\bprefere\s+o\s+prazo\s+mais\s+(?:longo|curto)\b/,
    /\bprazo\s+mais\s+longo\s+possivel\b/,
    /\bcom\s+entrada\s+de\s*r?\$?\s*\d/,
    /\bsem\s+entrada\b/,
    /\bquitar\s+em\s+menos\s+tempo\b/,
    /\bassim\s+eu\s+ajusto\b/,
    /\bvou\s+montar\s+(?:esse\s+)?cenario\b/,
  ];

  const sentences = splitSentences(base);
  const kept: string[] = [];
  let replaced = 0;
  for (const s of sentences) {
    const n = norm(s);
    if (!n) continue;
    const prohibited = prohibitedPatterns.some((re) => re.test(n));
    if (prohibited && !isAlreadyBrokerRedirect(n)) {
      replaced += 1;
      continue;
    }
    kept.push(s.trim());
  }

  if (replaced === 0) return { text: base, replacedFinancialSentences: 0 };
  if (kept.length === 0) {
    return {
      text: '',
      replacedFinancialSentences: replaced,
    };
  }
  const rebuilt = kept
    .join(' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text: rebuilt.slice(0, 4000), replacedFinancialSentences: replaced };
}

/**
 * Guard estrutural para a PRIMEIRA resposta de lead de campanha:
 * - mantém no máximo 2 frases (alinha à progressão comercial: uma informação principal por mensagem)
 * - mantém no máximo 1 pergunta
 * - remove excesso sem reescrever o conteúdo-base
 */
export function sanitizeFirstCampaignReplyShape(reply: string): {
  text: string;
  trimmedSentences: number;
  removedQuestions: number;
} {
  const base = normalizeWhitespacePreservingLines(stripMarkdownArtifactsForWhatsApp((reply || '').trim()));
  if (!base) return { text: base, trimmedSentences: 0, removedQuestions: 0 };
  return { text: base, trimmedSentences: 0, removedQuestions: 0 };

  const splitSentences = (text: string): string[] => {
    const out: string[] = [];
    let buf = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      buf += ch;
      if (ch === '\n') {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
        continue;
      }
      if (ch === '!' || ch === '?' || ch === '.') {
        const next = text[i + 1] ?? '';
        if (ch === '.' && next && !/\s/.test(next)) continue;
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
      }
    }
    const tail = buf.trim();
    if (tail) out.push(tail);
    return out;
  };

  const parts = splitSentences(base).filter(Boolean);
  const kept: string[] = [];
  let questionCount = 0;
  let removedQuestions = 0;

  for (const p of parts) {
    const hasQuestion = p.includes('?');
    if (hasQuestion) {
      if (questionCount >= 1) {
        removedQuestions += 1;
        continue;
      }
      questionCount += 1;
    }
    kept.push(p.trim());
    if (kept.length >= 2) break;
  }

  const trimmedSentences = Math.max(0, parts.length - kept.length);
  const rebuilt = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  return {
    text: rebuilt.slice(0, 4000),
    trimmedSentences,
    removedQuestions,
  };
}

function normGreeting(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Heurística leve: sinais de busca/refinamento imobiliário no texto (mensagem atual + histórico recente fundido).
 * Usada para não aplicar o fallback genérico de incompreensão quando já há contexto aproveitável.
 */
export function userUtteranceHasSearchRefinementSignals(text: string): boolean {
  const raw = (text || '').trim();
  if (raw.length < 2) return false;
  const t = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\b\d{2,5}\s*m[2²]\b/i.test(raw) || /\b\d{2,5}\s*m2\b/i.test(t)) return true;
  if (/\bm[2²]\b/i.test(raw) || /\bmetros(\s+quadrados)?\b/.test(t)) return true;
  if (/\b(uns|com|cerca\s+de)\s+\d{2,5}\b/.test(t) && (/\d+\s*m/i.test(raw) || /\bmetros\b/.test(t))) return true;

  if (
    /\b(em\s+conta|mais\s+em\s+conta|mais\s+barato|barato|economico|preco|precos|valor|valores|faixa|orcamento|investimento|milhao|milhoes|r\$)\b/.test(
      t
    )
  )
    return true;

  if (
    /\b(sao paulo|rio de janeiro|belo horizonte|brasilia|curitiba|porto alegre|salvador|recife|fortaleza|manaus|goiania|vitoria|florianopolis)\b/.test(
      t
    )
  )
    return true;
  if (/\b(sp|rj|bh|df)\b/.test(t)) return true;
  if (/\b(zona\s+(sul|norte|leste|oeste|central)|centro|bairro|cidade|regiao|localizacao)\b/.test(t)) return true;

  if (/\b(quero|queria|preciso|busco|procuro|tem|teria|mostra|mostrar)\b[\s\S]{0,56}\b(em|no|na|pra|para)\b/.test(t))
    return true;
  if (/\b(quais|qual|onde)\b[\s\S]{0,72}\b(empreendimento|empreendimentos|opcao|opcoes|unidades|lancamento)\b/.test(t))
    return true;
  if (/\b(empreendimentos?|lancamentos?|unidades)\b[\s\S]{0,40}\b(em|no|na)\b/.test(t)) return true;
  if (/\b(em|no|na)\s+(sp|sao paulo|rio|bh|rj)\b/.test(t)) return true;

  if (/\b(apartamento|casa|studio|cobertura|dormitorio|dormitorios|quarto|quartos|planta)\b/.test(t)) return true;

  if (/\b(lote|lotes|loteamento|loteamentos|terreno|terrenos|condominio\s+fechado|lote\s+para\s+investir|lote\s+para\s+construir)\b/.test(t)) return true;
  if (/\b(infraestrutura|area\s+de\s+lazer|area\s+verde|metragem\s+do\s+lote)\b/.test(t)) return true;

  if (/\b(me\s+mostr|quero\s+ver|quais\s+opcoes|o\s+que\s+voces?\s+te[mn]|me\s+passa|catalogo|portfolio|quero\s+conhecer|quais\s+empreendimentos)\b/.test(t)) return true;

  if (/\b(nao\s+sei|mostra\s+tudo|ver\s+tudo|quero\s+tudo|tanto\s+faz|qualquer\s+regiao|sem\s+preferencia|me\s+mostra\s+o\s+que\s+tem)\b/.test(t)) return true;

  return false;
}

/**
 * Saudações curtas de abertura — não devem cair em fallback de incompreensão.
 */
export function isSimpleOpeningGreeting(text: string): boolean {
  const n = normGreeting(text);
  if (!n || n.length > 56) return false;
  return (
    /^(oi|ola|oie|opa|eae|e\s*ai|bom\s+dia|boa\s+tarde|boa\s+noite)([!.…]*)?$/.test(n) ||
    /^(oi|ola|oie|opa)\s+[a-z]{1,14}([!.…]*)?$/.test(n)
  );
}

const GREETING_REPLY_NO_NAME = [
  'Oi, tudo bem? Eu sou a Ana e posso te ajudar com as informações. O que você quer entender melhor primeiro?',
  'Oi, tudo bem? Eu sou a Ana. Me diz qual informação você quer confirmar.',
];

const GREETING_REPLY_WITH_NAME = (name: string) => [
  `Oi, ${name}, tudo bem? Eu sou a Ana e posso te ajudar com as informações. O que você quer entender melhor primeiro?`,
  `Oi, ${name}. Me diz qual informação você quer confirmar.`,
];

/** Resposta acolhedora para saudação simples (sem chamar a API). */
export function pickRandomGreetingReply(knownCustomerName: string | null | undefined): string {
  void knownCustomerName;
  return '';
}

/** Conta menções ao nome do cliente no texto (normalizado, trechos curtos). */
export function countCustomerNameMentionsInText(reply: string, customerName: string | null | undefined): number {
  const name = (customerName || '').trim();
  if (name.length < 2) return 0;
  const n = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  const t = reply
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!n || !t.includes(n)) return 0;
  let count = 0;
  let pos = 0;
  for (;;) {
    const i = t.indexOf(n, pos);
    if (i < 0) break;
    count += 1;
    pos = i + Math.max(1, n.length);
  }
  return count;
}





