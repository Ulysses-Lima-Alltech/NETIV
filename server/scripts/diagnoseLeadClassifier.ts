import { classifyLeadConversation } from '../services/leadClassificationService.js';
import { listEnterprises } from '../repositories/enterpriseRepository.js';
import { listEnterpriseAliasRowsForActiveEnterprises } from '../repositories/enterpriseMatch.js';
import type { ConversationMessageSnippet } from '../repositories/messageRepository.js';
import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';
import type { EnterpriseAliasRowInput } from '../services/leadClassificationService.js';
import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';

interface DiagnosticScenario {
  label: string;
  message: string;
  currentTemperature: string | null;
  currentEnterpriseId: number | null;
  currentFunnelStatus: string | null;
}

function printDivider(): void {
  console.log('='.repeat(96));
}

async function run(): Promise<void> {
  const hasDatabaseUrl = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.trim().length > 0;
  console.log(`[lead-classifier-diagnostic] has_DATABASE_URL=${hasDatabaseUrl}`);

  try {
    const cfg = await getOpenAIConfig();
    console.log('[lead-classifier-diagnostic] integration_settings:', {
      found: !!cfg,
      has_openai_api_key: !!cfg?.openaiApiKey?.trim(),
      openai_base_url: cfg?.openaiBaseUrl ?? null,
      model_cold_lead: cfg?.modelColdLead ?? null,
      model_hot_lead: cfg?.modelHotLead ?? null,
    });
  } catch (error) {
    console.log(
      `[lead-classifier-diagnostic] falha ao ler integration_settings (${error instanceof Error ? error.message : String(error)})`
    );
  }

  let availableEnterprises: EnterpriseRow[] = [];
  let aliasRows: EnterpriseAliasRowInput[] = [];
  let offlineMode = false;
  try {
    availableEnterprises = await listEnterprises(true);
    aliasRows =
      availableEnterprises.length > 0
        ? await listEnterpriseAliasRowsForActiveEnterprises(availableEnterprises.map((item) => item.id))
        : [];
    console.log('[lead-classifier-diagnostic] fonte de empreendimentos: banco');
  } catch (error) {
    offlineMode = true;
    console.log(
      `[lead-classifier-diagnostic] banco indisponivel (${error instanceof Error ? error.message : String(error)}), usando fallback offline.`
    );
    const now = new Date();
    availableEnterprises = [
      {
        id: 1,
        name: 'Residencial Évora',
        slug: 'residencial-evora',
        status: 'ativo',
        language_style: 'natural',
        prompt_addons: '[]',
        tipo: 'APARTAMENTO',
        exclusivo: false,
        city: null,
        state_uf: null,
        commercial_region: null,
        ibge_code: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: 2,
        name: 'EcoGarden',
        slug: 'ecogarden',
        status: 'ativo',
        language_style: 'natural',
        prompt_addons: '[]',
        tipo: 'LOTEAMENTO',
        exclusivo: false,
        city: null,
        state_uf: null,
        commercial_region: null,
        ibge_code: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: 3,
        name: 'Montaresa',
        slug: 'montaresa',
        status: 'ativo',
        language_style: 'natural',
        prompt_addons: '[]',
        tipo: 'APARTAMENTO',
        exclusivo: false,
        city: null,
        state_uf: null,
        commercial_region: null,
        ibge_code: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: 4,
        name: 'Altis',
        slug: 'altis',
        status: 'ativo',
        language_style: 'natural',
        prompt_addons: '[]',
        tipo: 'APARTAMENTO',
        exclusivo: false,
        city: null,
        state_uf: null,
        commercial_region: null,
        ibge_code: null,
        created_at: now,
        updated_at: now,
      },
    ];
    aliasRows = [
      { enterprise_id: 1, alias: 'Evora', normalized_alias: 'evora' },
      { enterprise_id: 2, alias: 'Eco Garden', normalized_alias: 'eco garden' },
      { enterprise_id: 2, alias: 'EcoGardwn', normalized_alias: 'ecogardwn' },
      { enterprise_id: 2, alias: 'EcoGardem', normalized_alias: 'ecogardem' },
    ];
    console.log('[lead-classifier-diagnostic] fonte de empreendimentos: fallback offline');
  }

  const scenarios: DiagnosticScenario[] = [
    {
      label: 'Scenario 1',
      message: 'Oi',
      currentTemperature: null,
      currentEnterpriseId: null,
      currentFunnelStatus: 'Novo',
    },
    {
      label: 'Scenario 2',
      message: 'Gostaria de informações sobre os terrenos',
      currentTemperature: 'frio',
      currentEnterpriseId: null,
      currentFunnelStatus: 'Novo',
    },
    {
      label: 'Scenario 3',
      message: 'Quero saber sobre o Ecogardwn',
      currentTemperature: 'frio',
      currentEnterpriseId: null,
      currentFunnelStatus: 'Novo',
    },
    {
      label: 'Scenario 4',
      message: 'Quero agendar uma visita',
      currentTemperature: 'morno',
      currentEnterpriseId: null,
      currentFunnelStatus: 'Qualificado',
    },
    {
      label: 'Scenario 5',
      message: 'Qual o valor da parcela no Évora?',
      currentTemperature: 'morno',
      currentEnterpriseId: null,
      currentFunnelStatus: 'Qualificado',
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    const recentMessages: ConversationMessageSnippet[] = [
      { role: 'user', content: scenario.message },
    ];
    const decision = await classifyLeadConversation(
      {
        conversationId: 900000 + index,
        contactId: null,
        latestCustomerMessage: scenario.message,
        recentMessages,
        currentTemperature: scenario.currentTemperature,
        currentEnterpriseId: scenario.currentEnterpriseId,
        currentFunnelStatus: scenario.currentFunnelStatus,
        availableEnterprises,
        enterpriseAliasRows: aliasRows,
        manualOverrideFlags: {
          temperature: false,
          enterprise: false,
        },
      },
      offlineMode
        ? {
            loadOpenAIConfig: async () => null,
          }
        : undefined
    );

    printDivider();
    console.log(`${scenario.label}`);
    console.log(`input: ${scenario.message}`);
    console.log(`temperatura anterior: ${scenario.currentTemperature ?? 'null'}`);
    console.log(`temperatura sugerida: ${decision.temperature}`);
    console.log(`empreendimento sugerido: ${decision.enterpriseId ?? 'null'} (${decision.enterpriseName ?? 'null'})`);
    console.log(`funil sugerido: ${decision.funnelStatus ?? 'null'}`);
    console.log(
      `confianca: temp=${decision.temperatureConfidence.toFixed(3)} enterprise=${decision.enterpriseConfidence.toFixed(3)} funnel=${decision.funnelConfidence.toFixed(3)}`
    );
    console.log(
      `applied/ignored: temp=${decision.shouldUpdateTemperature ? 'applied' : 'ignored'} enterprise=${decision.shouldUpdateEnterprise ? 'applied' : 'ignored'} funnel=${decision.shouldUpdateFunnel ? 'applied' : 'ignored'}`
    );
    console.log(`ignoredReason: ${decision.ignoredReasons.length > 0 ? decision.ignoredReasons.join(';') : 'null'}`);
    console.log(`source: ${decision.source}`);
  }
  printDivider();
}

run().catch((error) => {
  console.error('[lead-classifier-diagnostic] erro:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
