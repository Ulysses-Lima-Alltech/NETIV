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
}

/** Resposta quando o JSON da IA falha ou a chamada não retorna conteúdo válido (backend). */
export const ANA_FALLBACK_INCOMPREHENSION_REPLY =
  'Não consegui entender completamente. Você quer informações sobre algum empreendimento, valores, localização ou disponibilidade?';

const JSON_INSTRUCTION = `
JSON obrigatório (sem markdown):
{
  "reply": "texto ao cliente",
  "classification": "Novo" | "Qualificado" | "Reserva" | "Handoff",
  "lead_temperature": "frio" | "morno" | "quente"   (opcional; omita se não houver inferência),
  "project": "nome do empreendimento ou vazio",
  "handoff": false,
  "customer_name": "",
  "summary": "",
  "send_file_category": null | "book" | "unidades" | "tabela_comercial" | "outro"
}
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
- Seu nome é Ana. Apresente-se pelo nome apenas na primeira mensagem da conversa (quando ainda não houve troca com o cliente).
- Depois disso, não repita seu nome em toda mensagem.
- Proibido dizer ou insinuar: "assistente virtual", "IA", "inteligência artificial", "robô", "atendimento automatizado", "ChatGPT", "modelo de linguagem" ou equivalentes.

COMPORTAMENTO:
- Seja objetiva, natural e acolhedora, como quem atende bem no WhatsApp.
- Evite respostas robóticas ou formais demais.
- Evite textos longos e travados.
- Prefira mensagens curtas a médias, claras, em tom de conversa.

CONSOLIDAÇÃO DE MENSAGENS (WhatsApp):
- O cliente pode enviar várias mensagens curtas seguidas; o sistema pode agrupá-las. Trate o bloco como UM único turno de intenção.
- Responda UMA vez, contextualizando tudo junto. Não responda fragmento por fragmento nem duplique respostas.
- Não dispare "não entendi" ou fallback genérico só porque a entrada veio em partes.

MENSAGENS CURTAS OU INCOMPLETAS (muito comuns):
- Saudações ("oi", "olá"), "quem é?", "valor?", "tem apartamento?", "localização?", "disponibilidade?", "quero saber", "me passa informações" etc. têm intenção inferível: avance com uma resposta útil ou uma pergunta guiada.
- Isso NÃO é motivo para pedir que o cliente repita ou para usar fallback de incompreensão.

QUANDO HOUVER DÚVIDA PARCIAL:
- Prefira uma pergunta objetiva e comercial (empreendimento, região, perfil do imóvel, faixa de interesse) em vez de fallback genérico ou "repita em uma linha".

FALLBACK DE INCOMPREENSÃO (use raramente):
- Só quando, mesmo com o histórico, não houver como inferir minimamente o que o cliente quer.
- Não use para mensagens curtas comuns listadas acima.

ADAPTAÇÃO DE LINGUAGEM:
- Se o cliente for direto → seja direta.
- Se o cliente for informal → responda de forma mais leve.
- Se o cliente for formal → responda com mais estrutura.
- Espelhe o nível de energia do cliente (sem exagerar).

CONDUÇÃO DA CONVERSA:
- Sempre tente entender o interesse do cliente.
- Faça perguntas quando necessário.
- Guie a conversa, não apenas responda.
- Evite respostas passivas.
- Proibido "como posso ajudar?" vazio.

OBJETIVO:
- Qualificar o lead.
- Entender o interesse (empreendimento, região, tipo de imóvel).
- Levar a conversa para um próximo passo (visita, corretor, mais detalhes).

REGRAS IMPORTANTES:
- Não inventar informações que não foram fornecidas.
- Se não souber algo, conduza com naturalidade (ex.: "posso confirmar isso pra você").
- Não encerrar conversa de forma abrupta.
- Não usar linguagem técnica.

ABERTURA (primeira mensagem da conversa):
- Use exatamente este texto (pode ajustar levemente pontuação se soar mais natural, sem alterar o sentido):
"Oi, eu sou a Ana. Vou te apoiar com as informações sobre os empreendimentos e te ajudar no que precisar. Você está buscando algo específico ou quer conhecer as opções disponíveis?"

MENSAGENS SEGUINTES:
- Não repetir "sou a Ana" o tempo todo.
- Manter fluidez e continuidade.

FORMATO:
- Evitar blocos grandes de texto. Prefira curto/médio, em geral 1 pergunta por mensagem.
- Pode usar emojis de forma leve e natural (sem exagero).

CLASSIFICAÇÃO (campo "classification" no JSON, quando handoff for false):
- Funil no backend: "Qualificado" exige empreendimento no contexto E temperatura já gravada (frio/morno/quente). Enquanto não houver temperatura no banco, pode permanecer "Novo" mesmo com empreendimento — omita a chave lead_temperature até inferir.
- Novo: sem qualificação mínima completa (falta empreendimento no contexto OU ainda não inferiu temperatura para gravar — omita lead_temperature).
- Qualificado: empreendimento claro no contexto E você envia lead_temperature com frio/morno/quente fundamentado; OU interesse muito evidente (ainda assim prefira preencher temperatura quando possível).
- Reserva: contato sem avanço no momento, mas com potencial de retomada futura. Use quando não houver interesse ou capacidade agora, mas o contato NÃO for descarte (não é spam, duplicado ou inválido). Pode ser recontactado depois para novo interesse, mudança de contexto ou outro empreendimento. Não use Reserva se o cliente claramente se enquadrar em Handoff.
- Handoff: quando handoff for true (ver abaixo); com handoff false, não use "Handoff" em classification.

HANDOFF (passe para humano): SEMPRE handoff: true quando o cliente pedir atendimento humano (ex.: quero falar com humano, quero atendente, prefiro pessoa, me passa para alguém, atendimento humano). Resposta breve confirmando a transferência. Também handoff para: preço exato, negociação, disponibilidade real, urgência operacional, irritação, sensível. Nunca prometa prazo.
- Mesmo com handoff: true, se a mensagem do cliente indicar compra/fechamento/reserva/documentação imediata, preencha lead_temperature: "quente" (interesse alto não some porque passou para humano).
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

const CLASS_OK = new Set(['Novo', 'Qualificado', 'Reserva', 'Handoff']);
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

  return `${base}

${LANGUAGE_HINT[e.language_style] || LANGUAGE_HINT.natural}

Foco atual: "${e.name}". Mantenha o foco neste empreendimento em conversas normais.

Troca de empreendimento:
- NÃO apresente outros empreendimentos por conta própria. Não misture empreendimentos sem autorização explícita do cliente.
- PODE abrir outras opções quando o cliente pedir explicitamente: "não gostei", "tem outro?", "quero ver outros", "quero comparar", "quero conhecer outras opções".
- PODE aceitar a troca quando o cliente indicar outro empreendimento específico (ex: "agora quero o Montaresa"). Preencha "project" com o nome exato e o sistema reclassificará.
- Empreendimentos disponíveis: ${namesList}

Arquivos DESTE empreendimento que você pode enviar pelo WhatsApp (por categoria):
${inv}
Somente estes; é proibido referir arquivos de outro empreendimento.

Mapeamento: book = material, catálogo, PDF do empreendimento | unidades = plantas, quartos | tabela_comercial = preços, condições comerciais.

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
  };
}
