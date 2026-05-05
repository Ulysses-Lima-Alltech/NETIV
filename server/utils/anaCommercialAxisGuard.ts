/**
 * Guard determinístico: garante no máximo UM eixo comercial principal por mensagem,
 * mesmo que o modelo gere texto panorâmico. Não depende só do prompt.
 */

export type CommercialAxis =
  | 'preco'
  | 'metragem_tipologia'
  | 'localizacao'
  | 'lazer'
  | 'financiamento'
  | 'disponibilidade'
  | 'visita_agendamento'
  | 'intencao_compra';

export type PurchaseIntent = 'MORADIA' | 'INVESTIMENTO';

const AXIS_ORDER: CommercialAxis[] = [
  'preco',
  'intencao_compra',
  'localizacao',
  'metragem_tipologia',
  'lazer',
  'financiamento',
  'disponibilidade',
  'visita_agendamento',
];

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Detecta eixos presentes no texto (heurística por palavras-chave / padrões). */
export function detectCommercialAxes(text: string): CommercialAxis[] {
  const t = norm(text);
  if (!t) return [];
  const found = new Set<CommercialAxis>();

  if (
    /\br\$\s*[\d.,]+/i.test(text) ||
    /\bvalores?\b/.test(t) ||
    /\bpre[cç]o(s)?\b/.test(t) ||
    /\b(parte|partir)\s+de\b/.test(t) ||
    /\ba partir\b/.test(t) ||
    /\b\d{2,3}\s*mil\b/.test(t)
  ) {
    found.add('preco');
  }

  if (
    /\bm[²2]\b/.test(text) ||
    /\bmetros?\s+quadrados?\b/.test(t) ||
    /\bquantos?\s+metros?\b/.test(t) ||
    /\btamanho\b/.test(t) ||
    /\barea\s+do\s+lote\b/.test(t) ||
    /\barea\s+do\s+apartamento\b/.test(t) ||
    /\barea\s+util\b/.test(t) ||
    /\bdormit[oó]rios?\b/.test(t) ||
    /\bquartos?\b/.test(t) ||
    /\bplanta(s)?\b/.test(t) ||
    /\btipologia\b/.test(t) ||
    /\bmetragem\b/.test(t) ||
    /\bunidades?\s+de\s+[12]\b/.test(t) ||
    /\b\d+[,.]?\d*\s*m[²2]\b/i.test(text)
  ) {
    found.add('metragem_tipologia');
  }

  if (
    /\besta[çc][aã]o\b/.test(t) ||
    /\bmetros?\s+(da|de)\s+/.test(t) ||
    /\b\d+\s*metros?\b/.test(t) ||
    /\bbairro\b/.test(t) ||
    /\blocaliza(c|ç)(a|ã)o\b/.test(t) ||
    /\bond[e']?\s+fica\b/.test(t) ||
    /\bproxim(o|a|idade)?\b/.test(t) ||
    /\bem s[aã]o paulo\b/.test(t) ||
    /\bvila\s+[a-záéíóúãõç]+\b/i.test(text) ||
    /\bcidade\b/.test(t) ||
    /\bfica em\b/.test(t) ||
    /\bregi[aã]o\b/.test(t)
  ) {
    found.add('localizacao');
  }

  if (
    /\blazer\b/.test(t) ||
    /\brooftop\b/.test(t) ||
    /\bpiscina\b/.test(t) ||
    /\bdiferenciais?\b/.test(t) ||
    /\bamenit/.test(t) ||
    /\b(area|areas)\s+(de\s+)?lazer\b/.test(t) ||
    /\bareas?\s+comuns?\b/.test(t)
  ) {
    found.add('lazer');
  }

  if (
    /\bfinanciamento\b/.test(t) ||
    /\bformas?\s+de\s+pagamento\b/.test(t) ||
    /\bcondic(?:ao|oes)\s+de\s+pagamento\b/.test(t) ||
    /\bparcelamento\b/.test(t) ||
    /\bpagamento\b/.test(t) ||
    /\bcaixa\b/.test(t) ||
    /\bmcmv\b/.test(t) ||
    /\bsubs[ií]dio(s)?\b/.test(t) ||
    /\bminha casa minha vida\b/.test(t) ||
    /\bparcela(s)?\b/.test(t) ||
    /\bentrada\b/.test(t) && /\b(financiamento|parcela|caixa|mcmv)\b/.test(t)
  ) {
    found.add('financiamento');
  }

  if (/\bdisponibilidade\b/.test(t) || /\b[uú]ltimas unidades\b/.test(t) || /\bunidades dispon[ií]veis\b/.test(t)) {
    found.add('disponibilidade');
  }

  if (/\bagendar\b/.test(t) || /\bvisita\b/.test(t) || /\bagenda\b/.test(t)) {
    found.add('visita_agendamento');
  }

  if (
    /\bmorar\b/.test(t) ||
    /\bmoradia\b/.test(t) ||
    /\binvestir\b/.test(t) ||
    /\binvestimento(s)?\b/.test(t) ||
    /\brenda\b/.test(t) ||
    /\bobjetivo\b/.test(t) ||
    /\bfinalidade\b/.test(t) ||
    /\badquirir\b/.test(t) ||
    /\bmorar ou investir\b/.test(t)
  ) {
    found.add('intencao_compra');
  }

  return AXIS_ORDER.filter((a) => found.has(a));
}

/** Infere o eixo que o usuário pediu neste turno (pergunta específica). */
export function inferUserRequestedAxis(userMessage: string | null | undefined): CommercialAxis | null {
  const u = norm(userMessage || '');
  if (!u) return null;

  if (/\b(quanto|custa|valor|pre[cç]o|r\$)\b/.test(u)) return 'preco';
  if (/\b(onde fica|localiza|endere[çc]o|bairro|estação|estacao|cidade|regi[aã]o|proxim|metros? da)\b/.test(u)) return 'localizacao';
  if (
    /\b(m[²2]|metragem|planta|dormit[oó]rio|quarto|tipologia|tamanho|quantos metros|area do lote|area do apartamento|area util)\b/.test(
      u
    )
  ) {
    return 'metragem_tipologia';
  }
  if (/\b(lazer|piscina|rooftop|diferenciais?|amenidades?)\b/.test(u)) return 'lazer';
  if (/\b(area|areas)\s+(de\s+)?lazer\b/.test(u) || /\bareas?\s+comuns?\b/.test(u)) return 'lazer';
  if (
    /\b(financiamento|parcela|entrada|caixa|mcmv|subs[ií]dio|pagamento|parcelamento)\b/.test(u) ||
    /\bformas?\s+de\s+pagamento\b/.test(u) ||
    /\bcondic(?:ao|oes)\s+de\s+pagamento\b/.test(u)
  ) {
    return 'financiamento';
  }
  if (/\b(disponibilidade|tem unidade|unidades dispon)\b/.test(u)) return 'disponibilidade';
  if (/\b(agendar|visita)\b/.test(u)) return 'visita_agendamento';
  if (/\b(morar|moradia|investir|investimento|renda|objetivo|finalidade)\b/.test(u)) return 'intencao_compra';

  return null;
}

function hasHousingIntentSignal(t: string): boolean {
  if (!t) return false;
  return (
    /\b(morar|moradia|residir|residencia|uso proprio)\b/.test(t) ||
    /\b(pra|para|como)\s+morar\b/.test(t)
  );
}

function hasInvestmentIntentSignal(t: string): boolean {
  if (!t) return false;
  return (
    /\b(investir|investimento|investimentos|renda|retorno|valorizacao)\b/.test(t) ||
    /\b(pra|para|como)\s+investir\b/.test(t) ||
    /\b(estamos\s+procurando\s+investimento)\b/.test(t) ||
    /\balgo\s+para\s+renda\b/.test(t)
  );
}

/**
 * Detecta quando o cliente respondeu de forma definitiva ao eixo morar x investir.
 * Retorna null quando o texto nao resolve esse eixo.
 */
export function inferResolvedPurchaseIntent(userMessage: string | null | undefined): PurchaseIntent | null {
  const u = norm(userMessage || '');
  if (!u) return null;

  const housing = hasHousingIntentSignal(u);
  const investment = hasInvestmentIntentSignal(u);

  if (investment && !housing) return 'INVESTIMENTO';
  if (housing && !investment) return 'MORADIA';

  if (/\b(mais\s+pra|mais\s+para)\s+investir\b/.test(u)) return 'INVESTIMENTO';
  if (/\b(mais\s+pra|mais\s+para)\s+morar\b/.test(u)) return 'MORADIA';

  return null;
}

/** Detecta pergunta binaria desse eixo (morar x investir). */
export function isPurchaseIntentAxisQuestion(text: string | null | undefined): boolean {
  const t = norm(text || '');
  if (!t) return false;
  if (/\bmorar ou investir\b/.test(t)) return true;
  if (/\b(foco|objetivo|finalidade|intencao)\b/.test(t) && /\bmorar\b/.test(t) && /\binvestir\b/.test(t)) return true;
  if (/\b(olhando|pensando)\b/.test(t) && /\bmorar\b/.test(t) && /\binvestir\b/.test(t)) return true;
  return false;
}

function isBroadInformationAsk(userMessage: string | null | undefined): boolean {
  const u = norm(userMessage || '');
  if (!u) return true;
  if (inferUserRequestedAxis(userMessage || '') != null) return false;
  return (
    /\b(mais )?informa(ç|c)(o|õ)es\b/.test(u) ||
    /\bquero saber mais\b/.test(u) ||
    /\bme fala\b/.test(u) ||
    /\bme conta\b/.test(u) ||
    /\bdetalhes\b/.test(u) ||
    /\bcomercial(is)?\b/.test(u) ||
    /\bsobre o empreendimento\b/.test(u) ||
    /\bsobre esse\b/.test(u) ||
    /\bquero mais\b/.test(u) ||
    /\bcontinua\b/.test(u) ||
    /\bpr[oó]ximo passo\b/.test(u)
  );
}

function pickTargetAxis(
  detected: CommercialAxis[],
  userAxis: CommercialAxis | null,
  isFirstAnaReply: boolean,
  userMessage: string
): CommercialAxis {
  if (userAxis && detected.includes(userAxis)) return userAxis;
  if (userAxis) return userAxis;

  const broad = isBroadInformationAsk(userMessage);

  if (isFirstAnaReply && broad) {
    if (detected.includes('preco')) return 'preco';
    if (detected.includes('intencao_compra')) return 'intencao_compra';
  }

  for (const a of AXIS_ORDER) {
    if (detected.includes(a)) return a;
  }
  return detected[0]!;
}

/** Corta para no máx. 2 frases e no máx. 1 pergunta (mantém a última pergunta se houver). */
function enforceShortShape(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s) return s;

  const parts: string[] = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    buf += ch;
    if (ch === '!' || ch === '?') {
      const t = buf.trim();
      if (t) parts.push(t);
      buf = '';
    } else if (ch === '.' && i < s.length - 1) {
      const next = s[i + 1] ?? '';
      if (/\d/.test(s[i - 1] ?? '') && /\d/.test(next)) continue;
      const t = buf.trim();
      if (t) parts.push(t);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);

  const sentences = parts.length > 0 ? parts : [s];
  const withQuestion = sentences.filter((x) => x.includes('?'));
  const withoutQ = sentences.filter((x) => !x.includes('?'));

  let out: string[] = [];
  if (withQuestion.length >= 1) {
    const q = withQuestion[withQuestion.length - 1]!;
    const before = withoutQ.slice(0, 2);
    out = [...before, q].filter(Boolean);
    if (out.length > 3) out = [before[0]!, q].filter(Boolean);
  } else {
    out = sentences.slice(0, 2);
  }

  let joined = out.join(' ').replace(/\s+/g, ' ').trim();
  const qCount = (joined.match(/\?/g) || []).length;
  if (qCount > 1) {
    const firstQ = joined.indexOf('?');
    joined = joined.slice(0, firstQ + 1).trim();
  }
  return joined.slice(0, 1200);
}

function extractPriceSnippet(original: string): string | null {
  const m =
    original.match(/r\$\s*[\d.,]+(?:\s*mil)?/i) ||
    original.match(/(?:parte|partir|a partir)\s+de\s+r\$\s*[\d.,]+(?:\s*mil)?/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

function hasEnterpriseMention(text: string, enterpriseName: string | undefined): boolean {
  const ent = (enterpriseName || '').trim();
  if (!ent) return false;
  const t = norm(text);
  const e = norm(ent);
  return !!e && t.includes(e);
}

function ensureEnterpriseMention(text: string, enterpriseName: string | undefined): { text: string; preserved: boolean } {
  const ent = (enterpriseName || '').trim();
  const raw = (text || '').trim();
  if (!ent || !raw) return { text: raw, preserved: false };
  if (hasEnterpriseMention(raw, ent)) return { text: raw, preserved: true };
  return { text: `Sobre ${ent}, ${raw}`.replace(/\s+/g, ' ').trim(), preserved: true };
}

function buildAdvanceReplyAfterResolvedPurchaseIntent(
  intent: PurchaseIntent | null,
  enterpriseName: string | undefined
): string {
  void intent;
  void enterpriseName;
  return '';
}

/** Tenta manter só frases que falam exclusivamente do eixo escolhido (+ saudação curta no início). */
function extractSingleAxisSlice(original: string, target: CommercialAxis): string | null {
  const raw = original.replace(/\s+/g, ' ').trim();
  const sentences = raw.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept: string[] = [];
  let keptTargetSentence = false;
  for (const sent of sentences) {
    const ax = detectCommercialAxes(sent);
    const greetingOnly =
      /^(oi|ol[aá]|bom dia|boa tarde|boa noite)\b/i.test(sent) && ax.length === 0 && sent.length < 80;
    if (greetingOnly) {
      kept.push(sent);
      continue;
    }
    if (ax.length === 1 && ax[0] === target) {
      kept.push(sent);
      keptTargetSentence = true;
    }
  }
  // Evita resposta truncada só com saudação (ex.: "Oi! Sou a Ana.").
  if (!keptTargetSentence) return null;
  const out = kept.join(' ').trim();
  if (!out) return null;
  const axesOut = detectCommercialAxes(out);
  return axesOut.length <= 1 && (axesOut.length === 0 || axesOut[0] === target) ? out : null;
}

function buildRewrittenReply(
  target: CommercialAxis,
  original: string,
  enterpriseName: string | undefined,
  resolvedPurchaseIntent: PurchaseIntent | null
): { text: string; enterprisePreserved: boolean } {
  const name = (enterpriseName || '').trim() || 'o empreendimento';
  const originalHasEnterprise = hasEnterpriseMention(original, enterpriseName);

  const extracted = extractSingleAxisSlice(original, target);
  if (extracted) {
    const shaped = enforceShortShape(extracted);
    if (!originalHasEnterprise) return { text: shaped, enterprisePreserved: false };
    const withEnterprise = ensureEnterpriseMention(shaped, enterpriseName);
    return { text: withEnterprise.text, enterprisePreserved: withEnterprise.preserved };
  }

  return { text: '', enterprisePreserved: false };

  let rewritten: string;
  switch (target) {
    case 'preco': {
      const price = extractPriceSnippet(original);
      if (price) {
        rewritten = enforceShortShape(
          ``
        );
        break;
      }
      rewritten = enforceShortShape(
        ``
      );
      break;
    }
    case 'intencao_compra':
      rewritten =
        resolvedPurchaseIntent != null
          ? buildAdvanceReplyAfterResolvedPurchaseIntent(resolvedPurchaseIntent, enterpriseName)
          : enforceShortShape(
              ``
            );
      break;
    case 'localizacao':
      rewritten = enforceShortShape(
        ``
      );
      break;
    case 'metragem_tipologia':
      rewritten = enforceShortShape(
        ``
      );
      break;
    case 'lazer':
      rewritten = enforceShortShape(
        ``
      );
      break;
    case 'financiamento':
      rewritten = enforceShortShape(
        ``
      );
      break;
    case 'disponibilidade':
      rewritten = enforceShortShape(`Sobre disponibilidade no ${name}, eu te passo o que consigo confirmar agora. Você está buscando algo para agora?`);
      break;
    case 'visita_agendamento':
      rewritten = enforceShortShape(`Vamos organizar sua visita ao ${name}. Qual dia costuma funcionar melhor pra sua rotina?`);
      break;
    default:
      rewritten = enforceShortShape(original);
      break;
  }
  if (!originalHasEnterprise) return { text: rewritten, enterprisePreserved: false };
  const withEnterprise = ensureEnterpriseMention(rewritten, enterpriseName);
  return { text: withEnterprise.text, enterprisePreserved: withEnterprise.preserved };
}

/**
 * Reduz reply a um único eixo comercial quando há 2+ eixos detectados.
 */
export function applyAnaCommercialSingleAxisGuard(opts: {
  reply: string;
  userMessage: string;
  isFirstAnaReply: boolean;
  enterpriseName?: string | null;
  conversationId?: number;
  resolvedPurchaseIntent?: PurchaseIntent | null;
  lastAssistantMessage?: string | null;
}): { text: string; changed: boolean; detected: CommercialAxis[]; chosen: CommercialAxis | null } {
  const raw = (opts.reply || '').trim();
  if (!raw) return { text: raw, changed: false, detected: [], chosen: null };
  const detected = detectCommercialAxes(raw);
  const userAxis = inferUserRequestedAxis(opts.userMessage);
  const chosen =
    detected.length === 0
      ? null
      : userAxis && detected.includes(userAxis)
        ? userAxis
        : detected[0] ?? null;

  const cid = opts.conversationId;
  if (detected.length > 1 || isPurchaseIntentAxisQuestion(raw)) {
    console.log('[ANA_AXIS_GUARD]', {
      conversationId: cid ?? null,
      mode: 'validation_only_no_rewrite',
      detected_axes: detected,
      chosen_axis: chosen,
      user_requested_axis: userAxis,
      reply_preview: raw.slice(0, 500),
      isFirstAnaReply: opts.isFirstAnaReply,
      enterpriseName: opts.enterpriseName ?? null,
      resolvedPurchaseIntent: opts.resolvedPurchaseIntent ?? null,
      lastAssistantAskedPurchaseIntent: isPurchaseIntentAxisQuestion(opts.lastAssistantMessage ?? ''),
    });
  }

  return { text: raw, changed: false, detected, chosen };
}
