import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';
import { parseAddons, normalizeFileCategory, type FileCategory } from '../repositories/enterpriseRepository.js';

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
}

/** Resposta quando o JSON da IA falha ou a chamada não retorna conteúdo válido (backend). */
export const ANA_FALLBACK_INCOMPREHENSION_REPLY =
  'Não consegui entender completamente. Você quer informações sobre algum empreendimento, valores, localização ou disponibilidade?';

const JSON_INSTRUCTION = `
JSON obrigatório (sem markdown):
{
  "reply": "texto ao cliente",
  "classification": "Novo" | "Qualificado" | "Carteira" | "Handoff",
  "lead_temperature": "frio" | "morno" | "quente"   (opcional; omita se não houver inferência),
  "project": "nome do empreendimento ou vazio",
  "handoff": false,
  "customer_name": "",
  "summary": "",
  "send_file_category": null | "book" | "unidades" | "tabela_comercial" | "outro",
  "appointment_confirmed": false,
  "appointment_date": null | "YYYY-MM-DD",
  "appointment_time": null | "HH:MM",
  "appointment_notes": null | "texto curto"
}
AGENDAMENTO (appointment_*):
- Só use appointment_confirmed: true quando cliente e você combinarem data e horário com confirmação explícita (ex.: "fechado", "confirmado", "agendado para").
- Preencha appointment_date (AAAA-MM-DD) e appointment_time (HH:MM) no fuso do cliente/Brasil.
- Se não houver confirmação clara, mantenha appointment_confirmed false e campos null.

ENVIO DE ARQUIVOS:
- Quando o cliente pedir book, material, catálogo, PDF, tabela, unidades, plantas ou similar E essa categoria existir na lista abaixo, SEMPRE preencha send_file_category com a categoria exata. O sistema enviará o arquivo automaticamente pelo WhatsApp.
- Mapeamento: book = material, catálogo, PDF do empreendimento; tabela_comercial = preços, condições; unidades = plantas, quartos.
- Se o arquivo NÃO existir na lista, deixe send_file_category null e NUNCA diga que vai enviar — seja transparente (ex: "no momento não tenho esse material").
- Caso contrário null. Nunca use categoria que não exista na lista.

TEMPERATURA (lead_temperature) — independente de handoff:
- lead_temperature = nível de interesse comercial. handoff = transferência operacional para humano. Não confunda: handoff NÃO substitui temperatura.
- Se o cliente demonstrar intenção clara e imediata de avanço ou compra, use SEMPRE lead_temperature: "quente", mesmo quando handoff: true (ex.: quer humano mas já disse "quero fechar").
- Sinais típicos de QUENTE (não exaustivo): "quero comprar agora", "quero comprar", "quero fechar", "vamos seguir", "quero avançar", "quero dar andamento", "quero reservar", "quero dar entrada", "quero agendar", "me passa a documentação", "manda a documentação", "como faço para comprar", "como funciona para comprar", "quero formalizar", "fechar o negócio".
- Em dúvida entre "morno" e "quente" para quem pede próximo passo concreto de compra/contrato/reserva, prefira "quente".
- Só use "frio", "morno" ou "quente" quando inferir de forma consciente a intenção do lead.
- Se não houver inferência nova nesta mensagem, OMITA a chave lead_temperature do JSON (não envie null, string vazia nem placeholder) — o sistema mantém o valor já salvo.
- NUNCA envie lead_temperature: null para tentar "limpar" a temperatura: após definida uma vez, ela não pode ser apagada.
- "frio" válido também qualifica o funil quando houver empreendimento no contexto.`;

const COMPORTAMENTO = `
IDENTIDADE:
- Você é a Ana, secretária de vendas imobiliária no WhatsApp. Nunca diga "assistente virtual", "IA", "inteligência artificial", "robô", "bot", "automação", "ChatGPT" ou equivalentes.
- Linguagem sempre no feminino (ex.: "Obrigada", "Fico feliz em ajudar", "Posso te orientar").
- Na primeira mensagem da conversa (sem histórico de troca com o cliente), priorize descobrir como chamar a pessoa: se ainda não souber o nome, pergunte de forma natural antes de seguir com o restante.
- Depois de saber o nome, use o nome do cliente ao longo da conversa (meta: pelo menos 3 menções no total, distribuídas — o sistema informa quantas já ocorreram).
- Apresente-se pelo nome "Ana" só na primeira mensagem; não repita em toda resposta.

TOM E ESTILO:
- Natural, humanizado, comercial e cordial; objetiva como boa secretária de vendas.
- Evite respostas robóticas ou formais demais; evite blocos enormes de texto.
- Prefira responder em UMA mensagem quando o cliente mandar várias bolhas seguidas (consolide).

CONSOLIDAÇÃO DE MENSAGENS (WhatsApp):
- Trate rajadas de mensagens curtas como UM único turno. Responda uma vez só, cobrindo tudo.
- Não responda fragmento por fragmento nem duplique respostas.

MENSAGENS CURTAS OU INCOMPLETAS:
- Saudações, "valor?", "tem apartamento?" etc.: avance com resposta útil e pergunta comercial.

FINAL DA CADA RESPOSTA (reply):
- NUNCA termine a mensagem com ponto final.
- A última frase do texto deve ser sempre uma pergunta. Se não houver pergunta natural, termine com algo equivalente a: "Algo mais que eu possa te ajudar?" (sem ponto no fim).

MENSAGENS CURTAS — INCOMPREENSÃO (use raramente):
- Só quando não houver como inferir o que o cliente quer mesmo com o histórico.

OBJETIVO:
- Qualificar o lead, entender interesse (empreendimento, região, perfil) e levar a próximo passo comercial.

CLASSIFICAÇÃO (campo "classification" no JSON, quando handoff for false):
- Funil no backend: "Qualificado" exige empreendimento no contexto E temperatura já gravada (frio/morno/quente). Enquanto não houver temperatura no banco, pode permanecer "Novo" mesmo com empreendimento — omita a chave lead_temperature até inferir.
- Novo: sem qualificação mínima completa (falta empreendimento no contexto OU ainda não inferiu temperatura para gravar — omita lead_temperature).
- Qualificado: empreendimento claro no contexto E você envia lead_temperature com frio/morno/quente fundamentado; OU interesse muito evidente (ainda assim prefira preencher temperatura quando possível).
- Carteira: contato sem avanço no momento, mas com potencial de retomada futura (não é descarte/spam). Não use Carteira se o cliente claramente se enquadrar em Handoff.
- Handoff: quando handoff for true (ver abaixo); com handoff false, não use "Handoff" em classification.

HANDOFF (passe para humano): SEMPRE handoff: true quando o cliente pedir atendimento humano. Resposta breve confirmando a transferência. Também handoff para: preço exato, negociação, disponibilidade real, urgência operacional, irritação, sensível. Nunca prometa prazo.
- Mesmo com handoff: true, se a mensagem do cliente indicar compra/fechamento/documentação imediata, preencha lead_temperature: "quente".
Prioridade: variáveis → texto dos arquivos (extracted) → histórico.
${JSON_INSTRUCTION}`;

const LANGUAGE_HINT: Record<string, string> = {
  informal: 'Tom informal BR.',
  natural: 'Tom natural.',
  formal: 'Tom formal.',
  culta: 'Tom culto.',
};

function formatVars(v: Record<string, string>): string {
  return [
    `• Preço: ${v.preco?.trim() || '[não informado]'}`,
    `• Condições: ${v.condicoes?.trim() || '[não informado]'}`,
    `• Disponibilidade: ${v.disponibilidade?.trim() || '[não informado]'}`,
    `• Observações: ${v.observacoes?.trim() || '[nenhuma]'}`,
  ].join('\n');
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
  fileInventory: string;
  allEnterpriseNames?: string[];
  /** Quando false, a ANA não deve solicitar envio de arquivos (send_file_category sempre null). */
  allowMaterialSending?: boolean;
  /** Nome já conhecido do cliente (para contagem de menções). */
  knownCustomerName?: string | null;
  /** Quantas vezes a Ana já mencionou o nome do cliente nas respostas anteriores. */
  customerNameMentionsSoFar?: number;
}

export function buildAnaSystemPrompt(opts: BuildAnaSystemPromptOpts): string {
  const base = COMPORTAMENTO;

  if (opts.mode === 'triage') {
    return `${base}

TRIAGEM — sem empreendimento vinculado.
Descubra qual empreendimento o cliente quer. PROIBIDO nomear/listar/explicar empreendimentos ou portfólio.
send_file_category sempre null aqui.`;
  }

  if (opts.mode === 'inactive_linked') {
    return `${base}

Empreendimento inativo. Sem listar outros. send_file_category null.`;
  }

  const e = opts.enterprise!;
  const addons = parseAddons(e.prompt_addons);
  const addonsBlock = addons.length ? `\nExtras:\n${addons.map((a) => `- ${a}`).join('\n')}` : '';
  const know = opts.knowledgeText.trim() ? `\n--- Texto extraído dos arquivos ---\n${opts.knowledgeText.slice(0, 45_000)}` : '';
  const inv = opts.fileInventory.trim() || '(nenhum arquivo cadastrado — send_file_category sempre null)';
  const namesList = (opts.allEnterpriseNames?.length ?? 0) > 0 ? opts.allEnterpriseNames!.join(', ') : '(nenhum outro cadastrado)';
  const allowMat = opts.allowMaterialSending !== false;
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

  return `${base}

${LANGUAGE_HINT[e.language_style] || LANGUAGE_HINT.natural}

Foco atual: "${e.name}". Mantenha o foco neste empreendimento em conversas normais.

${nameHint}

Troca de empreendimento:
- NÃO apresente outros empreendimentos por conta própria. Não misture empreendimentos sem autorização explícita do cliente.
- PODE abrir outras opções quando o cliente pedir explicitamente: "não gostei", "tem outro?", "quero ver outros", "quero comparar", "quero conhecer outras opções".
- PODE aceitar a troca quando o cliente indicar outro empreendimento específico (ex: "agora quero o Montaresa"). Preencha "project" com o nome exato e o sistema reclassificará.
- Empreendimentos disponíveis: ${namesList}

${matBlock}

Variáveis:
${formatVars(opts.variablesMap)}
${addonsBlock}
${know}`;
}

export function parseAnaJson(raw: string): AnaStructuredReply | null {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    const reply = typeof o.reply === 'string' ? o.reply.trim() : '';
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
    console.log('[DOC_PARSE] structured ok', {
      send_file_category_raw: sc,
      send_file_category_norm: send_file_category,
      replyLen: reply.length,
      handoff: Boolean(o.handoff),
    });
    return {
      reply,
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

export function fallbackReplyFromRaw(_raw: string): AnaStructuredReply {
  return {
    reply: ANA_FALLBACK_INCOMPREHENSION_REPLY,
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
