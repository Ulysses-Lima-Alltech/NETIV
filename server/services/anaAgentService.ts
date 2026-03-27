import type { EnterpriseRow, EnterpriseTipo } from '../repositories/enterpriseRepository.js';
import type { LocationQueryContext } from '../utils/anaEnterpriseLocationContext.js';
import { parseAddons, normalizeFileCategory, type FileCategory } from '../repositories/enterpriseRepository.js';
import {
  isSimpleOpeningGreeting,
  pickRandomGreetingReply,
  userUtteranceHasSearchRefinementSignals,
} from '../utils/anaReplyFinalize.js';
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
  'Me conta o que você procura que eu te ajudo.';

/** Quando o parse JSON falha mas há sinais de busca no histórico/mensagem — evita repetir a pergunta genérica acima. */
export const ANA_FALLBACK_REFINEMENT_CONTEXT_REPLY =
  'Me diz só a região e o que você procura que eu te mostro as opções.';

const ANA_FALLBACK_REFINEMENT_LOTEAMENTO_REPLY =
  'Me diz a região e a faixa de investimento que eu te mostro os lotes.';

/** Fallback de refinamento sensível ao tipo de produto inferido no contexto recente. */
export function buildRefinementContextReply(recentContext?: string): string {
  const ctx = (recentContext || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (/\b(lote|lotes|loteamento|terreno|terrenos|loteamentos)\b/.test(ctx)) {
    return ANA_FALLBACK_REFINEMENT_LOTEAMENTO_REPLY;
  }
  return ANA_FALLBACK_REFINEMENT_CONTEXT_REPLY;
}

const JSON_INSTRUCTION = `
JSON obrigatório (sem markdown no JSON):
REGRA CRÍTICA (campo "reply"):
- Se o cliente mencionar localização (cidade, bairro, estado), metragem (m²), preço ou intenção de economia, ou pedir empreendimentos/opções, o "reply" DEVE ser sugestão ou direcionamento comercial (portfólio, dados do prompt, próximo passo útil).
- NUNCA trate isso como incompreensão. NUNCA use no "reply" a pergunta genérica sobre "empreendimento, valores, localização ou disponibilidade" nesses casos, nem a repita se já houver contexto no histórico.
- Evite repetir a mesma pergunta genérica que já consta na última resposta sua no histórico; use "nextBestQuestion" para planejar UMA pergunta objetiva diferente quando precisar qualificar.
- Se o cliente disser "o que você tem?", "o que vocês têm?", "me mostra opções" depois de já ter citado tipo ou interesse, interprete como wantsCatalog: true e dê panorama do portfólio condizente com o que já foi entendido (sem recomeçar do zero).
- Frases como "quero loteamento", "quero comprar um lote", "lote", "terreno em condomínio" → productType: "LOTEAMENTO" e não conduza como fluxo de apartamento.
- O campo "reply" NUNCA pode conter dados comerciais inventados. Se um campo não existir nos dados fornecidos, não mencione. Não preencha lacunas com texto genérico ou suposição.

{
  "intent": "string curta: ex. qualificar, agendar, pedir_material, comparar, duvida",
  "productType": null | "LOTEAMENTO" | "APARTAMENTO" | "MCMV" | "INDEFINIDO",
  "wantsCatalog": false,
  "locationPreference": null | "texto curto inferido",
  "budgetPreference": null | "texto curto inferido",
  "bedroomsPreference": null | "texto curto inferido",
  "bathroomsPreference": null | "texto curto inferido",
  "userGoal": null | "comprar_para_morar" | "investir" | "construir" | "conhecer" | "outro",
  "lotSizePreference": null | "texto curto inferido (ex.: 300m², acima de 250m²)",
  "shouldShowPortfolio": false,
  "nextBestQuestion": null | "uma única pergunta objetiva sugerida para a próxima rodada (pode ser vazia se encerramento)",
  "reply": "texto ao cliente em texto puro para WhatsApp — sem *, **, _, #; use quebras de linha para organizar; para vários empreendimentos use o padrão 📍 💰 📄 📐 descrito nas regras de formatação",
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
- Leia o histórico: data/hora/empreendimento podem estar em mensagens anteriores; una tudo antes de responder.
- Se o cliente pedir mudar/remarcar/alterar horário, trate como atualização do mesmo pedido de visita — preencha appointment_date/appointment_time com a NOVA combinação quando ficar claro, sem ignorar o que já foi dito.

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
- NUNCA assuma que já sabe o nome do cliente. O sistema NÃO fornece o nome do perfil do WhatsApp. Só considere o nome conhecido quando o campo "Nome do cliente conhecido" estiver preenchido no bloco de contexto abaixo — isso só acontece depois que o próprio cliente informa o nome na conversa.
- Depois de saber o nome, use o nome do cliente ao longo da conversa (meta: pelo menos 3 menções no total, distribuídas — o sistema informa quantas já ocorreram).
- Apresente-se pelo nome "Ana" só na primeira mensagem; não repita em toda resposta.

TOM E ESTILO:
- Natural, humanizado, comercial e cordial; objetiva como boa secretária de vendas.
- Evite respostas robóticas, roteiros repetidos ou frases de manual em toda mensagem.
- Evite repetir a mesma pergunta de fechamento; varie a formulação conforme o assunto tratado.
- Evite blocos enormes de texto.
- Prefira responder em UMA mensagem quando o cliente mandar várias bolhas seguidas (consolide).
- NUNCA abra com frases como "Entendi, você está em busca de...", "Ótimo, vou te apresentar...", "Com certeza! Vou listar...". Responda direto ao ponto como pessoa do comercial faria no WhatsApp (ex.: "Tenho sim. Você procura em qual região?").

PROIBIÇÃO ABSOLUTA DE INVENTAR DADOS (prioridade máxima sobre qualquer outra instrução):
- NUNCA invente, suponha ou complete dados comerciais que não estejam explicitamente escritos no bloco "DADOS COMERCIAIS CADASTRADOS" ou nos textos extraídos de arquivos/book fornecidos neste prompt.
- Campos marcados como "[não informado]" ou "[nenhuma]" significam que o dado NÃO EXISTE no sistema. Não gere texto substituto para eles.
- É PROIBIDO inventar: preço, condição de pagamento, disponibilidade, metragem, infraestrutura, diferenciais, área de lazer, quantidade de unidades, status de obra, prazo de entrega, valores de entrada, parcelas ou qualquer dado comercial.
- Frases como "infraestrutura completa", "prontos para construir", "bairro em desenvolvimento", "unidades limitadas", "áreas de lazer", "consulte-nos para valores atualizados" SÓ podem aparecer se estiverem literalmente escritas nos dados fornecidos.
- Quando for listar empreendimentos, cite APENAS: nome e, se existirem no cadastro, cidade/região e os campos que tiverem valor real (não "[não informado]"). Se sobrar só o nome, cite só o nome.
- Em caso de dúvida entre inventar algo bonito ou não dizer nada: não diga nada. Prefira perguntar ao cliente o que ele quer saber.

CONSOLIDAÇÃO DE MENSAGENS (WhatsApp):
- Trate rajadas de mensagens curtas como UM único turno. Responda uma vez só, cobrindo tudo.
- Não responda fragmento por fragmento nem duplique respostas.

FORMATAÇÃO WHATSAPP (obrigatório no texto da resposta ao cliente):
- O canal é WhatsApp: o cliente vê texto puro. NUNCA use markdown (*, **, _, #, crases, listas com hífen técnico estilo código).
- Organize com quebras de linha; cada ideia importante pode ficar em linha própria. Evite parágrafo único gigante quando listar preços ou empreendimentos.
- Quando apresentar empreendimentos, use 📍 para o nome. Para os demais campos (💰📄📐📝), inclua APENAS as linhas cujo valor real esteja no cadastro (diferente de "[não informado]" e "[nenhuma]"). Se um campo estiver vazio, NÃO inclua a linha — omita. Se sobrar só o nome, cite só 📍 Nome. Não invente texto para preencher linhas vazias.
  Separe um empreendimento do outro com exatamente uma linha em branco.
- Se o prompt trouxer a seção "UX — LISTAGEM COMERCIAL", siga a abertura e o fechamento sugeridos para esta rodada (variação humana).
- Pode usar emojis discretos (📍 💰 📄 📐) para leitura; não exagere. Não use asteriscos para “negrito”.
- Tom de secretária comercial: cordial e claro, não parecendo relatório técnico nem dump de sistema.

SAUDAÇÕES SIMPLES (oi, olá, bom dia, boa tarde, boa noite):
- Trate sempre como abertura normal de conversa, nunca como mensagem incompreensível.
- Responda de forma acolhedora como secretária de vendas; não diga que "não entendeu" só por ser curto.

MENSAGENS CURTAS OU INCOMPLETAS:
- Avance com resposta útil e pergunta comercial alinhada ao que deu para inferir.

REGRA CRÍTICA (obrigatória — tem prioridade sobre "incompreensão" e sobre qualquer roteiro genérico):
- Se o cliente mencionar QUALQUER um destes: localização (cidade, bairro, estado), metragem (m²), preço ou intenção de economia ("em conta", "barato", faixa), ou pedido de empreendimentos/opções/lançamentos — você DEVE responder com sugestão ou direcionamento comercial (o que couber do cadastro/portfólio no prompt, ou como avançar na qualificação sem resetar o diálogo).
- NUNCA trate isso como incompreensão. NUNCA diga que "não entendeu" ou que a mensagem foi ambígua só por ser curta.
- NUNCA repita a pergunta genérica pedindo para escolher entre "empreendimento, valores, localização ou disponibilidade" quando já houver esse tipo de contexto no histórico ou na mensagem atual — e evite essa frase fixa em geral; prefira pergunta específica sobre o que ainda falta (ex.: só orçamento, só região dentro da cidade).
- Se o cliente pediu opções/empreendimentos/portfólio mas AINDA NÃO informou localização, a próxima ação preferencial é perguntar a localização de forma natural (ex.: "Tenho sim. Você procura em qual região?"). Não despeje lista antes de saber onde o cliente quer.

BUSCA / REFINAMENTO (mensagens curtas em sequência — prioridade):
- Trate expressões como "quero em São Paulo", "algo mais em conta", "com uns 300m²", "tem em SP?", "quais empreendimentos em..." como continuação da mesma intenção: una tudo com o histórico recente antes de responder.
- Se o cliente já citou cidade/região, metragem, faixa/orçamento ("em conta"), tipo de imóvel ou pedido de opções na região, NÃO resete a conversa com pergunta genérica pedindo para escolher entre "empreendimento, valores, localização ou disponibilidade" e NÃO repita essa mesma formulação se ela já tiver aparecido no histórico.
- Responda com base no que já foi dito; se faltar apenas um dado, pergunte só esse dado, de forma específica.

ENCERRAMENTO DA CONVERSA (prioridade sobre a pergunta final):
- Se o cliente agradecer e encerrar claramente (ex.: "obrigado", "não preciso de mais nada", "por enquanto é só", "no momento não, obrigado", "valeu", "depois eu chamo", "qualquer coisa eu chamo", "era isso", "tá bom obrigado"), NÃO faça pergunta no final.
- Nesse caso: agradeça, seja breve e cordial, diga que ficou à disposição — sem insistir, sem reabrir o assunto e sem "?" no final.
- Não use frases como "Posso te ajudar com mais alguma coisa?" quando o tom for despedida.

FINAL DA CADA RESPOSTA (reply) — regra geral (conversa ainda aberta):
- A última frase do texto deve ser sempre uma pergunta real, com "?" no final.
- A pergunta final deve ser contextual: conecte ao assunto que você acabou de tratar (lazer, localização, metragem, valores, etc.).
- Só use pergunta genérica de continuidade quando não houver uma pergunta melhor; nesse caso varie a formulação (não use sempre a mesma frase).
- Exemplos de espírito (adapte ao contexto, não copie literalmente): "Tem alguma dessas opções de lazer que mais te interessa?", "Você quer que eu te explique também os acessos e pontos próximos?", "Você quer que eu te mostre quais opções estão mais alinhadas com essa metragem?", "Você quer que eu te explique as faixas de investimento disponíveis?"

MENSAGENS AMBÍGUAS — INCOMPREENSÃO (use raramente):
- Só quando realmente não houver como inferir o que o cliente quer mesmo com o histórico. Nunca use isso para saudação trivial ou cumprimento.
- PROIBIDO tratar como incompreensível quando houver menção a: localização (cidade, bairro, estado), metragem (m²), preço ou economia, ou pedido de empreendimentos — nesses casos sempre resposta comercial (regra crítica acima).
- Quando realmente não entender, responda de forma curta e humana, como alguém do comercial faria. Ex.: "Me conta o que você procura que eu te ajudo." — sem frases como "não peguei bem essa parte", "me conta em uma frase", "que eu te direciono certinho".

OBJETIVO:
- Qualificar o lead, entender interesse (empreendimento, região, perfil) e levar a próximo passo comercial.

CLASSIFICAÇÃO (campo "classification" no JSON, quando handoff for false):
- Funil no backend: "Qualificado" exige empreendimento no contexto E temperatura já gravada (frio/morno/quente). Enquanto não houver temperatura no banco, pode permanecer "Novo" mesmo com empreendimento — omita a chave lead_temperature até inferir.
- Novo: sem qualificação mínima completa (falta empreendimento no contexto OU ainda não inferiu temperatura para gravar — omita lead_temperature).
- Qualificado: empreendimento claro no contexto E você envia lead_temperature com frio/morno/quente fundamentado; OU interesse muito evidente (ainda assim prefira preencher temperatura quando possível).
- Carteira: contato sem avanço no momento, mas com potencial de retomada futura (não é descarte/spam). Não use Carteira se o cliente claramente se enquadrar em Handoff.
- Handoff: quando handoff for true (ver abaixo); com handoff false, não use "Handoff" em classification.

HANDOFF (passe para humano): SEMPRE handoff: true quando o cliente pedir atendimento humano. Resposta breve confirmando a transferência. Também handoff para: negociação personalizada além do cadastro, disponibilidade operacional em tempo real não refletida nas variáveis, urgência operacional, irritação, sensível. Nunca prometa prazo.
- Se existir bloco "DADOS COMERCIAIS CADASTRADOS" com preço/condições preenchidos, use esses dados para responder — não diga que não tem acesso; handoff não substitui essa informação.
- Mesmo com handoff: true, se a mensagem do cliente indicar compra/fechamento/documentação imediata, preencha lead_temperature: "quente".
Prioridade: variáveis → texto dos arquivos (extracted) → histórico.
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
  'Posso te ajudar a comparar melhor esses dois?',
  'Quer que eu detalhe algum deles pra você?',
  'Quer que eu te ajude a comparar melhor as opções?',
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

Regras obrigatórias:
- Para valor, preço, condições, disponibilidade: use literalmente o que consta acima quando NÃO for "[não informado]" ou "[nenhuma]".
- Campos marcados "[não informado]" ou "[nenhuma]": OMITA completamente na resposta ao cliente. Não mostre a linha, não invente texto substituto, não diga "consulte-nos", não preencha com texto genérico. Simplesmente não mencione esse campo.
- Na resposta ao cliente, cite 📍 nome e apenas as linhas que tiverem valor real preenchido. Se sobrar só o nome, cite só o nome (sem linhas 💰📄📐📝 vazias).
- Não diga que não tem acesso aos valores quando o campo "Preço" estiver preenchido acima.
- Com mais de um empreendimento, um bloco 📍 por projeto; entre blocos use apenas uma linha em branco.
- NUNCA invente descrição, diferencial ou texto comercial que não esteja explícito acima ou nos trechos de book/arquivos. Se um empreendimento tem poucos dados, cite pouco — não complete com texto bonito.
- Handoff humano por "preço/negociação" só quando o cliente pedir negociação fora do cadastro ou informação que não está acima.`;
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
}

function buildTipoComercialBlock(tipo: EnterpriseTipo, enterpriseName: string): string {
  const base = `TIPO DO EMPREENDIMENTO NO CADASTRO: "${tipo}" (${enterpriseName}). O "reply" e as perguntas devem obedecer a este tipo.`;
  if (tipo === 'LOTEAMENTO') {
    return `${base}
- NUNCA pergunte dormitórios ou banheiros.
- Priorize: localização, faixa de investimento, metragem do lote, finalidade do lote, infraestrutura, condições comerciais (somente o que existir no cadastro/book).`;
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
  mode: 'triage' | 'scoped' | 'inactive_linked'
): string {
  if (mode === 'inactive_linked') return '';
  if (mode === 'scoped' && enterprise) {
    return `

${buildTipoComercialBlock(enterprise.tipo, enterprise.name)}`;
  }
  return `

TIPO DE PRODUTO (triagem — inferir do cliente quando ainda não houver empreendimento focado):
- "loteamento", "lote", "terreno", "comprar um lote" → productType "LOTEAMENTO" no JSON; não conduza como apartamento.
- MCMV / minha casa / faixa de renda explícita → productType "MCMV" quando aplicável.
- Demais → "APARTAMENTO" ou "INDEFINIDO" se não houver sinal claro.`;
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

export function buildAnaSystemPrompt(opts: BuildAnaSystemPromptOpts): string {
  const base = COMPORTAMENTO;
  const loc = opts.locationQueryContext ?? null;
  const locationBlock = loc ? buildLocationQueryBlock(loc) : '';
  const commercialListUx =
    opts.commercialListUxHints != null ? buildCommercialListUxBlock(opts.commercialListUxHints) : '';
  const commercialBlock = buildCommercialDataBlock(opts.commercialSnapshots ?? []) + commercialListUx;

  if (opts.mode === 'triage') {
    const namesList =
      loc?.isEmpty
        ? '(nenhum empreendimento ativo no banco para esta cidade/região)'
        : (opts.allEnterpriseNames?.length ?? 0) > 0
          ? opts.allEnterpriseNames!.join(', ')
          : '(nenhum empreendimento ativo cadastrado)';
    const cls = (opts.conversationClassification || 'Novo').trim();
    const ap = opts.appointmentPreflight;
    const openCtx = (opts.openAppointmentSummary || '').trim()
      ? `

AGENDAMENTO JÁ REGISTRADO (sistema):
${(opts.openAppointmentSummary || '').trim()}
Trate a mensagem atual como complemento ou remarcação; não reinicie triagem nem repita empreendimento/data/hora já cobertos acima ou no histórico.`
      : '';

    const portfolioLine = loc
      ? `Lista autorizada para ESTA consulta de localização (única fonte de nomes — não use outro portfólio nem lista global): ${namesList}`
      : `Empreendimentos ativos no portfólio (use apenas estes nomes, não invente outros): ${namesList}`;

    const triageLocationBullets = loc
      ? `- O cliente perguntou sobre uma localidade específica: use APENAS availableEnterprises do bloco "CONSULTA POR LOCALIZAÇÃO" e a lista autorizada acima. Não volte ao portfólio geral.
- Não sugira empreendimento de outra cidade/região fora do filtro. Não diga que não há opções se availableEnterprises não estiver vazio.`
      : `- Quando o cliente pedir opções de forma ampla (ex.: "o que vocês têm", "quero ver opções", "me mostra loteamentos") e AINDA NÃO tiver informado localização (cidade, região, bairro), a prioridade é perguntar a localização ANTES de listar empreendimentos. Exemplo: "Tenho sim. Você procura em qual região ou cidade?" — não despeje portfólio genérico sem saber onde o cliente quer.
- Exceção: se TODOS os empreendimentos ativos estiverem na mesma cidade/região, pode citar isso de forma natural (ex.: "Nossas opções são em Jacareí. Quer que eu te mostre?").
- Quando a localização já for conhecida ou o cliente pedir lista mesmo sem dizer a cidade, apresente opções usando APENAS dados reais do cadastro (nome + campos preenchidos). Não invente descrição nem diferenciais para completar a lista.`;

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
${buildEnterpriseTipoDirective(null, 'triage')}

${locationBlock ? `${locationBlock}

` : ''}${commercialBlock ? `${commercialBlock}

` : ''}TRIAGEM — ainda sem empreendimento vinculado ao foco da conversa.
${portfolioLine}
Classificação atual no sistema (referência): "${cls}".
${openCtx}
${appointmentPriority}

- Descubra interesse e qual empreendimento faz sentido para o cliente.
${triageLocationBullets}
- Se a classificação estiver como Novo e não houver empreendimento focado, priorize destravar o atendimento com poucas opções claras em vez de respostas vazias.
- Não despeje informação demais; organize em poucas linhas e feche com pergunta contextual ao tema.
- send_file_category: null neste modo (sem envio de arquivo até haver empreendimento ativo no foco).`;
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

REGRA — BOOK / DOCUMENTOS:
- O texto acima vem de arquivos e trechos indexados do empreendimento. Use como fonte para localização, proposta, infraestrutura e condições quando constarem.
- Não invente dados que não apareçam no cadastro nem no material acima.

PANORAMA DO EMPREENDIMENTO:
- Quando o cliente pedir "me conta sobre", "como é", "o que tem", "quais os diferenciais", "panorama", "resumo" ou pedido similar, monte um resumo estruturado usando SOMENTE dados reais do cadastro e dos trechos acima.
- Itens possíveis: proposta/conceito, localização, diferenciais, infraestrutura/lazer, perfil ideal, condições comerciais.
- Inclua apenas o que estiver documentado; omita seções sem informação em vez de inventar.` : ''}`;
}

const MIN_SALVAGED_REPLY_CHARS = 20;

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
  _raw: string,
  userMessage?: string,
  knownCustomerName?: string | null,
  appointmentFlow?: boolean,
  appointmentContinuation?: boolean,
  recentContextForHeuristic?: string
): AnaStructuredReply {
  const blob = [recentContextForHeuristic, userMessage].filter(Boolean).join('\n');
  const reply =
    userMessage && isSimpleOpeningGreeting(userMessage)
      ? pickRandomGreetingReply(knownCustomerName)
      : appointmentFlow && appointmentContinuation
        ? ANA_FALLBACK_APPOINTMENT_CONTINUATION_REPLY
        : appointmentFlow
          ? ANA_FALLBACK_APPOINTMENT_FLOW_REPLY
          : userUtteranceHasSearchRefinementSignals(blob)
            ? buildRefinementContextReply(blob)
            : ANA_FALLBACK_INCOMPREHENSION_REPLY;
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
