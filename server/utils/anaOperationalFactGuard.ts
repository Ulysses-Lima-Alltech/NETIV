/**
 * Guard centralizado contra alucinação factual de informações operacionais/cronológicas.
 *
 * Protege contra afirmações inventadas sobre:
 *   - prazo/data de entrega
 *   - status/estágio de obras
 *   - infraestrutura pronta ou disponível
 *   - liberação/possibilidade de construir
 *   - portaria/lazer/áreas comuns em fase final
 *
 * Lógica:
 *   1. Detectar se o usuário perguntou sobre um fato operacional (QUERY GATE).
 *   2. Detectar se o reply contém afirmações operacionais inventadas (CLAIM SCAN).
 *   3. Verificar se as afirmações encontradas têm âncora nos dados oficiais (GROUNDING CHECK).
 *   4. Se há claims sem âncora → substituir reply por resposta neutra segura.
 */

// ─── Detecção de query operacional ─────────────────────────────────────────────

const OPERATIONAL_QUERY_RE =
  /\b(entrega|prazo|previs[aã]o|cronograma|quando\s+(entrega|fica\s+pronto|abre|vai\s+(estar|ficar))|obra|obras|andamento|constru[íi]|construindo|construiu|pode\s+construir|liberado|libera[çc][aã]o|infra(?:estrutura)?|portaria|lazer|[áa]rea\s+comum|[áa]reas\s+comuns|pronto\s+para\s+construir|fase\s+final|etapa|quando\s+posso|pode\s+morar|pode\s+iniciar|início\s+das\s+obras|j[áa]\s+(est[áa]|tem|pode)|quando\s+vai)\b/i;

/**
 * Detecta se a mensagem atual do usuário pergunta sobre fatos operacionais
 * (entrega, obra, infraestrutura, liberação para construir, etc.).
 */
export function userAskedAboutOperationalFacts(userText: string): boolean {
  return OPERATIONAL_QUERY_RE.test((userText || '').trim());
}

// ─── Padrões de claims inventados ──────────────────────────────────────────────

/**
 * Cada entrada representa uma afirmação operacional que a Ana não pode inventar.
 * `re`    — padrão que detecta a afirmação no texto do reply
 * `label` — identificador para grounding check e logs
 */
const HALLUCINATED_CLAIM_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /obras?\s+(avan[cç]ad|conclu[íi]d|finaliz|em\s+fase\s+final)/i,   label: 'obra_avancada' },
  { re: /em\s+fase\s+avan[cç]ada\s+de\s+obra/i,                           label: 'obra_avancada' },
  { re: /infra(?:estrutura)?\s+(pronta|completa|instalada|dispon[íi]vel)/i, label: 'infra_pronta' },
  { re: /j[áa]\s+(tem|h[áa]|existe)\s+infra(?:estrutura)?/i,              label: 'infra_pronta' },
  { re: /entrega\s+imediata/i,                                             label: 'entrega_imediata' },
  { re: /j[áa]\s+(?:est[áa]\s+)?entregue/i,                               label: 'entregue_imediata' },
  { re: /pode\s+(?:j[áa]\s+)?(?:iniciar|come[cç]ar|construir|edificar)/i, label: 'pode_construir' },
  { re: /j[áa]\s+pode\s+(?:construir|iniciar|come[cç]ar)/i,               label: 'pode_construir' },
  { re: /voc[eê]\s+j[áa]\s+pode\s+(?:iniciar|come[cç]ar|construir)/i,     label: 'pode_construir' },
  { re: /liberado\s+para\s+(?:construir|obra|edificar)/i,                  label: 'liberado_construir' },
  { re: /lote\s+(?:liberado|pronto\s+para\s+construir)/i,                  label: 'liberado_construir' },
  { re: /portaria\s+em\s+fase\s+final/i,                                   label: 'portaria_fase_final' },
  { re: /lazer\s+em\s+fase\s+final/i,                                      label: 'lazer_fase_final' },
  { re: /[áa]reas?\s+comuns?\s+em\s+fase\s+final/i,                       label: 'areas_fase_final' },
  { re: /in[íi]cio\s+(?:imediato|j[áa]|agora)\s+d[ae]\s+constru[cç][aã]o/i, label: 'construcao_imediata' },
];

export interface OperationalClaimScan {
  /** Há algum claim problemático no texto? */
  found: boolean;
  /** Lista de labels dos claims encontrados */
  matchedLabels: string[];
}

/** Escaneia o texto do reply em busca de afirmações operacionais inventáveis. */
export function scanOperationalClaims(replyText: string): OperationalClaimScan {
  const t = (replyText || '').trim();
  const matchedLabels: string[] = [];
  for (const { re, label } of HALLUCINATED_CLAIM_PATTERNS) {
    if (re.test(t) && !matchedLabels.includes(label)) {
      matchedLabels.push(label);
    }
  }
  return { found: matchedLabels.length > 0, matchedLabels };
}

// ─── Grounding check ───────────────────────────────────────────────────────────

/**
 * Verifica se um claim identificado pelo `label` tem âncora textual nos dados oficiais.
 * "Ancoragem" = a afirmação existe literalmente nos dados do empreendimento
 * (variáveis cadastradas + base de conhecimento).
 */
function isClaimGroundedInOfficialData(label: string, officialData: string): boolean {
  const d = (officialData || '').toLowerCase();
  switch (label) {
    case 'obra_avancada':
      return /obra.*avan[cç]/i.test(d) || /avan[cç].*obra/i.test(d) || /fase\s+avan[cç]ada/i.test(d);
    case 'infra_pronta':
      return /infra(?:estrutura)?\s*(pronta|completa|instalada)/i.test(d) || /j[áa]\s+tem\s+infra/i.test(d);
    case 'entrega_imediata':
      return /entrega\s+imediata/i.test(d);
    case 'entregue_imediata':
      return /j[áa]\s+(est[áa]\s+)?entregue/i.test(d);
    case 'pode_construir':
      return (
        /liberado\s+para\s+construir/i.test(d) ||
        /pode\s+construir/i.test(d) ||
        /permite\s+construir/i.test(d) ||
        /autorizado\s+para\s+construir/i.test(d)
      );
    case 'liberado_construir':
      return /liberado\s+para\s+construir/i.test(d) || /lote\s+liberado/i.test(d);
    case 'portaria_fase_final':
      return /portaria.*fase\s+final/i.test(d);
    case 'lazer_fase_final':
      return /lazer.*fase\s+final/i.test(d);
    case 'areas_fase_final':
      return /[áa]reas?\s+comuns?.*fase\s+final/i.test(d);
    case 'construcao_imediata':
      return /in[íi]cio\s+imediato.*constru[cç][aã]o/i.test(d);
    default:
      return false;
  }
}

// ─── Respostas ancoradas na ausência de dado ───────────────────────────────────

/**
 * Tópico operacional detectado na mensagem do usuário.
 * Usado para personalizar a resposta "não encontrei no material".
 */
type OperationalTopic =
  | 'entrega_prazo'
  | 'construir_liberacao'
  | 'obra_andamento'
  | 'infraestrutura'
  | 'portaria_lazer'
  | 'generic';

const TOPIC_PATTERNS: ReadonlyArray<{ re: RegExp; topic: OperationalTopic }> = [
  { re: /\b(entrega|prazo|previs[aã]o|quando\s+(entrega|fica\s+pronto|vai\s+ser\s+entregue)|data\s+de\s+entrega)\b/i, topic: 'entrega_prazo' },
  { re: /\b(construir|construção|construindo|liberado|libera[cç][aã]o|pode\s+construir|pode\s+iniciar|inicio\s+de\s+obra|começa(r)?\s+a\s+construir|pronto\s+para\s+construir)\b/i, topic: 'construir_liberacao' },
  { re: /\b(obra|obras|andamento|cronograma|fase|etapa|está(gio)?|como\s+(est[áa]o?|andam))\b/i, topic: 'obra_andamento' },
  { re: /\b(infra(estrutura)?|rede\s+de\s+[áa]gua|esgoto|eletricidade|asfalto|pavimenta[cç][aã]o)\b/i, topic: 'infraestrutura' },
  { re: /\b(portaria|lazer|salão|piscina|academia|playground|[áa]reas?\s+comuns?)\b/i, topic: 'portaria_lazer' },
];

function detectOperationalTopic(userText: string): OperationalTopic {
  const t = (userText || '').trim();
  for (const { re, topic } of TOPIC_PATTERNS) {
    if (re.test(t)) return topic;
  }
  return 'generic';
}

/**
 * Constrói uma resposta neutra ancorada na AUSÊNCIA de dado, específica ao tópico
 * perguntado. A resposta sempre menciona "material de apoio" para deixar claro que
 * a Ana buscou e não encontrou — não que está desviando ou pedindo para confirmar depois.
 */
export function pickOperationalSafeReply(userText: string): string {
  const topic = detectOperationalTopic(userText);
  switch (topic) {
    case 'entrega_prazo':
      return 'No material de apoio que tenho aqui, não encontrei uma data de entrega para esse empreendimento.';
    case 'construir_liberacao':
      return 'No material de apoio que tenho aqui, não encontrei informação sobre liberação para construir.';
    case 'obra_andamento':
      return 'No material de apoio que tenho aqui, não encontrei uma atualização sobre o andamento das obras.';
    case 'infraestrutura':
      return 'No material de apoio disponível aqui, não encontrei informação sobre o status da infraestrutura.';
    case 'portaria_lazer':
      return 'No material de apoio que tenho aqui, não encontrei o status de portaria ou áreas de lazer.';
    default:
      return 'No material de apoio que tenho aqui, não encontrei essa informação.';
  }
}

// ─── API principal ─────────────────────────────────────────────────────────────

export interface OperationalFactGuardResult {
  /** Texto final (original ou substituído) */
  text: string;
  /** true se o reply foi substituído por resposta neutra */
  replaced: boolean;
  /** Claims não ancorados que causaram a substituição */
  unsupportedClaims: string[];
  /** Claims encontrados que tinham âncora oficial (passaram) */
  groundedClaims: string[];
}

/**
 * Aplica o guard de fatos operacionais ao reply gerado pelo LLM.
 *
 * @param replyText    Texto de reply vindo do modelo
 * @param userText     Mensagem atual do usuário (rajada do turno)
 * @param officialData Dados oficiais: valores das variáveis + knowledgeText
 */
export function applyOperationalFactGuard(
  replyText: string,
  userText: string,
  officialData: string,
): OperationalFactGuardResult {
  const { found, matchedLabels } = scanOperationalClaims(replyText);

  if (!found) {
    return { text: replyText, replaced: false, unsupportedClaims: [], groundedClaims: [] };
  }

  const groundedClaims: string[] = [];
  const unsupportedClaims: string[] = [];

  for (const label of matchedLabels) {
    if (isClaimGroundedInOfficialData(label, officialData)) {
      groundedClaims.push(label);
    } else {
      unsupportedClaims.push(label);
    }
  }

  if (unsupportedClaims.length === 0) {
    // Todos os claims têm base oficial — deixa passar
    return { text: replyText, replaced: false, unsupportedClaims: [], groundedClaims };
  }

  // Substituir por resposta contextual ancorada na ausência de dado oficial
  return {
    text: pickOperationalSafeReply(userText),
    replaced: true,
    unsupportedClaims,
    groundedClaims,
  };
}
