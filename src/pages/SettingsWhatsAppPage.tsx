import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import {
  settingsApi,
  type ApiGlobalSettingsPublic,
  type ApiGlobalSettingsUpdate,
  type EnterpriseApiConnectionTestResult,
  type EnterpriseApiSettingsItem,
  type EnterpriseApiSettingsUpdate,
  type WhatsAppConfigPublic,
  type WhatsAppConfigUpdate,
} from '../api/client';

const field =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3.5 py-[10px] text-[14px] text-[#111827] placeholder:text-[#9CA3AF] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

const card = 'bg-white rounded-[12px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-6';

const sectionH = 'text-[16px] font-semibold text-[#111827] mb-5';

const lbl = 'block text-[13px] font-medium text-[#6B7280] mb-1.5';

const btnPrimary =
  'inline-flex items-center justify-center gap-2 text-[14px] font-semibold bg-[#F97316] text-white rounded-[10px] px-6 py-[10px] hover:bg-[#EA580C] active:bg-[#C2410C] disabled:opacity-40 transition-colors shadow-sm';

const btnSecondary =
  'inline-flex items-center justify-center gap-2 text-[14px] font-medium text-[#374151] bg-white border border-[#E5E7EB] rounded-[10px] px-5 py-[10px] hover:bg-[#F9FAFB] disabled:opacity-40 transition-colors';

function Alert({ type, text }: { type: 'success' | 'error'; text: string }) {
  const styles =
    type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100';
  return (
    <div className={`flex items-start gap-2 text-[13px] rounded-[10px] border px-4 py-3 ${styles}`}>
      {type === 'success' ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 mt-px"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 mt-px"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )}
      {text}
    </div>
  );
}

type TabKey = 'whatsapp' | 'api';

interface EnterpriseApiFormState {
  use_global_defaults: boolean;
  openai_api_key_input: string;
  remove_api_key: boolean;
  openai_api_key_id: string;
  openai_project_id: string;
  openai_base_url: string;
  model_hot_lead: string;
  model_cold_lead: string;
  ai_enabled: boolean;
  emergency_block_enabled: boolean;
  emergency_block_message: string;
  cost_tracking_enabled: boolean;
}

function asNullableString(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Nunca testado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR');
}

function buildEnterpriseForm(item: EnterpriseApiSettingsItem): EnterpriseApiFormState {
  return {
    use_global_defaults: item.use_global_defaults,
    openai_api_key_input: '',
    remove_api_key: false,
    openai_api_key_id: item.openai_api_key_id ?? '',
    openai_project_id: item.openai_project_id ?? '',
    openai_base_url: item.openai_base_url ?? '',
    model_hot_lead: item.model_hot_lead ?? '',
    model_cold_lead: item.model_cold_lead ?? '',
    ai_enabled: item.ai_enabled,
    emergency_block_enabled: item.emergency_block_enabled,
    emergency_block_message: item.emergency_block_message ?? '',
    cost_tracking_enabled: item.cost_tracking_enabled,
  };
}

function normalizeEnterpriseForms(items: EnterpriseApiSettingsItem[]): Record<number, EnterpriseApiFormState> {
  const next: Record<number, EnterpriseApiFormState> = {};
  for (const item of items) next[item.enterprise_id] = buildEnterpriseForm(item);
  return next;
}

export function SettingsWhatsAppPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('whatsapp');

  const [config, setConfig] = useState<WhatsAppConfigPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<
    WhatsAppConfigUpdate & { metaAccessTokenInput?: string; webhookVerifyTokenInput?: string }
  >({
    metaAccessTokenInput: '',
    whatsappPhoneNumberId: '',
    whatsappBusinessAccountId: '',
    apiVersion: 'v21.0',
    webhookVerifyTokenInput: '',
    defaultSendPhoneNumber: null,
    defaultCountryCode: null,
    enabled: false,
  });
  const [showToken, setShowToken] = useState(false);
  const [showWebhookToken, setShowWebhookToken] = useState(false);

  const [apiLoading, setApiLoading] = useState(true);
  const [apiLoadError, setApiLoadError] = useState<string | null>(null);
  const [apiMessage, setApiMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingGlobalApi, setSavingGlobalApi] = useState(false);
  const [savingEnterpriseId, setSavingEnterpriseId] = useState<number | null>(null);
  const [testingEnterpriseId, setTestingEnterpriseId] = useState<number | null>(null);
  const [expandedEnterpriseId, setExpandedEnterpriseId] = useState<number | null>(null);
  const [showGlobalApiKeyInput, setShowGlobalApiKeyInput] = useState(false);

  const [apiGlobal, setApiGlobal] = useState<ApiGlobalSettingsPublic | null>(null);
  const [apiGlobalForm, setApiGlobalForm] = useState<
    ApiGlobalSettingsUpdate & {
      openai_api_key_input: string;
      remove_api_key: boolean;
      openai_api_key_id_input: string;
      openai_project_id_input: string;
      openai_base_url_input: string;
      model_hot_lead_input: string;
      model_cold_lead_input: string;
      temperature_input: number;
      max_tokens_input: number;
      lead_score_threshold_input: number;
      ai_enabled_input: boolean;
    }
  >({
    provider: 'openai',
    openai_api_key_input: '',
    remove_api_key: false,
    openai_api_key_id_input: '',
    openai_project_id_input: '',
    openai_base_url_input: '',
    model_hot_lead_input: '',
    model_cold_lead_input: '',
    temperature_input: 0.5,
    max_tokens_input: 700,
    lead_score_threshold_input: 0.75,
    ai_enabled_input: true,
  });

  const [apiEnterpriseItems, setApiEnterpriseItems] = useState<EnterpriseApiSettingsItem[]>([]);
  const [apiEnterpriseForms, setApiEnterpriseForms] = useState<Record<number, EnterpriseApiFormState>>({});
  const [availableModels, setAvailableModels] = useState<
    Array<{
      value: string;
      label: string;
      description: string;
      recommendedFor: 'hot' | 'cold' | 'advanced' | 'realtime';
    }>
  >([]);

  const hasApiData = useMemo(() => apiGlobal != null || apiEnterpriseItems.length > 0, [apiGlobal, apiEnterpriseItems]);

  const loadApiSettings = async (): Promise<void> => {
    const [globalResult, enterprisesResult] = await Promise.allSettled([
      settingsApi.getApiGlobal(),
      settingsApi.getApiEnterprises(),
    ]);

    const hasModelsFromGlobal =
      globalResult.status === 'fulfilled' && Array.isArray(globalResult.value.available_models);

    if (globalResult.status === 'fulfilled') {
      const global = globalResult.value;
      setApiGlobal(global);
      if (Array.isArray(global.available_models)) {
        setAvailableModels(global.available_models);
      }
      setApiGlobalForm((prev) => ({
        ...prev,
        provider: 'openai',
        openai_api_key_input: '',
        remove_api_key: false,
        openai_api_key_id_input: global.openai_api_key_id ?? '',
        openai_project_id_input: global.openai_project_id ?? '',
        openai_base_url_input: global.openai_base_url ?? '',
        model_hot_lead_input: global.model_hot_lead ?? '',
        model_cold_lead_input: global.model_cold_lead ?? '',
        temperature_input: global.temperature,
        max_tokens_input: global.max_tokens,
        lead_score_threshold_input: global.lead_score_threshold,
        ai_enabled_input: global.ai_enabled,
      }));
    }

    if (enterprisesResult.status === 'fulfilled') {
      if (!hasModelsFromGlobal && Array.isArray(enterprisesResult.value.available_models)) {
        setAvailableModels(enterprisesResult.value.available_models);
      }
      const items = [...enterprisesResult.value.enterprises].sort((a, b) =>
        a.enterprise_name.localeCompare(b.enterprise_name, 'pt-BR')
      );
      setApiEnterpriseItems(items);
      setApiEnterpriseForms(normalizeEnterpriseForms(items));
      if (items.length > 0 && expandedEnterpriseId == null) {
        setExpandedEnterpriseId(items[0]?.enterprise_id ?? null);
      }
    }

    if (globalResult.status === 'rejected') {
      setApiLoadError(globalResult.reason?.message ?? 'Erro ao carregar configuração global de API.');
    } else if (enterprisesResult.status === 'rejected') {
      setApiLoadError(enterprisesResult.reason?.message ?? 'Erro ao carregar configuração por empreendimento.');
    } else {
      setApiLoadError(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([settingsApi.getWhatsApp(), loadApiSettings()])
      .then(([whatsappResult]) => {
        if (cancelled) return;
        if (whatsappResult.status === 'fulfilled') {
          const d = whatsappResult.value;
          setConfig(d);
          setForm((prev) => ({
            ...prev,
            whatsappPhoneNumberId: d.whatsappPhoneNumberId,
            whatsappBusinessAccountId: d.whatsappBusinessAccountId,
            apiVersion: d.apiVersion,
            defaultSendPhoneNumber: d.defaultSendPhoneNumber,
            defaultCountryCode: d.defaultCountryCode,
            enabled: d.enabled,
            metaAccessTokenInput: '',
            webhookVerifyTokenInput: '',
          }));
        } else {
          setLoadError(whatsappResult.reason?.message ?? 'Erro ao carregar configurações do WhatsApp.');
        }
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setApiLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const payload: WhatsAppConfigUpdate = {
      whatsappPhoneNumberId: form.whatsappPhoneNumberId || undefined,
      whatsappBusinessAccountId: form.whatsappBusinessAccountId || undefined,
      apiVersion: form.apiVersion || undefined,
      defaultSendPhoneNumber: form.defaultSendPhoneNumber ?? undefined,
      defaultCountryCode: form.defaultCountryCode ?? undefined,
      enabled: form.enabled,
    };
    if (form.metaAccessTokenInput) payload.metaAccessToken = form.metaAccessTokenInput;
    if (form.webhookVerifyTokenInput) payload.webhookVerifyToken = form.webhookVerifyTokenInput;

    settingsApi
      .putWhatsApp(payload)
      .then((data) => {
        setConfig(data);
        setForm((prev) => ({ ...prev, metaAccessTokenInput: '', webhookVerifyTokenInput: '' }));
        setMessage({ type: 'success', text: 'Configurações de WhatsApp salvas com sucesso.' });
      })
      .catch((err: Error) => {
        setMessage({ type: 'error', text: err.message ?? 'Erro ao salvar configurações do WhatsApp.' });
      })
      .finally(() => setSaving(false));
  };

  const handleTestConnection = () => {
    setTesting(true);
    setMessage(null);
    settingsApi
      .testWhatsApp()
      .then((data) => {
        setMessage({ type: 'success', text: data.message ?? 'Conexão com a Meta validada com sucesso.' });
      })
      .catch((err: Error) => {
        setMessage({ type: 'error', text: err.message ?? 'Erro ao verificar conexão com a Meta.' });
      })
      .finally(() => setTesting(false));
  };

  const handleSaveGlobalApi = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingGlobalApi(true);
    setApiMessage(null);

    const payload: ApiGlobalSettingsUpdate = {
      provider: 'openai',
      remove_api_key: apiGlobalForm.remove_api_key,
      openai_api_key_id: asNullableString(apiGlobalForm.openai_api_key_id_input),
      openai_project_id: asNullableString(apiGlobalForm.openai_project_id_input),
      openai_base_url: asNullableString(apiGlobalForm.openai_base_url_input),
      model_hot_lead: asNullableString(apiGlobalForm.model_hot_lead_input),
      model_cold_lead: asNullableString(apiGlobalForm.model_cold_lead_input),
      ai_enabled: apiGlobalForm.ai_enabled_input,
      temperature: apiGlobalForm.temperature_input,
      max_tokens: apiGlobalForm.max_tokens_input,
      lead_score_threshold: apiGlobalForm.lead_score_threshold_input,
    };

    const newApiKey = apiGlobalForm.openai_api_key_input.trim();
    if (newApiKey.length > 0) payload.openai_api_key = newApiKey;

    try {
      const saved = await settingsApi.putApiGlobal(payload);
      setApiGlobal(saved);
      await loadApiSettings();
      setApiGlobalForm((prev) => ({
        ...prev,
        openai_api_key_input: '',
        remove_api_key: false,
      }));
      setApiMessage({ type: 'success', text: 'Configuração global de API salva com sucesso.' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao salvar configuração global de API.';
      setApiMessage({ type: 'error', text: msg });
    } finally {
      setSavingGlobalApi(false);
    }
  };

  const updateEnterpriseForm = (enterpriseId: number, updater: (state: EnterpriseApiFormState) => EnterpriseApiFormState) => {
    setApiEnterpriseForms((prev) => {
      const current = prev[enterpriseId];
      if (!current) return prev;
      return { ...prev, [enterpriseId]: updater(current) };
    });
  };

  const handleSaveEnterprise = async (enterpriseId: number) => {
    const formState = apiEnterpriseForms[enterpriseId];
    if (!formState) return;

    setSavingEnterpriseId(enterpriseId);
    setApiMessage(null);

    const payload: EnterpriseApiSettingsUpdate = {
      provider: 'openai',
      use_global_defaults: formState.use_global_defaults,
      remove_api_key: formState.remove_api_key,
      openai_api_key_id: asNullableString(formState.openai_api_key_id),
      openai_project_id: asNullableString(formState.openai_project_id),
      openai_base_url: asNullableString(formState.openai_base_url),
      model_hot_lead: asNullableString(formState.model_hot_lead),
      model_cold_lead: asNullableString(formState.model_cold_lead),
      ai_enabled: formState.ai_enabled,
      emergency_block_enabled: formState.emergency_block_enabled,
      emergency_block_message: asNullableString(formState.emergency_block_message),
      cost_tracking_enabled: formState.cost_tracking_enabled,
    };

    const newApiKey = formState.openai_api_key_input.trim();
    if (newApiKey.length > 0) payload.openai_api_key = newApiKey;

    try {
      await settingsApi.putApiEnterprise(enterpriseId, payload);
      await loadApiSettings();
      setApiMessage({ type: 'success', text: 'Configuração do empreendimento salva com sucesso.' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao salvar configuração do empreendimento.';
      setApiMessage({ type: 'error', text: msg });
    } finally {
      setSavingEnterpriseId(null);
    }
  };

  const handleTestEnterprise = async (enterpriseId: number) => {
    setTestingEnterpriseId(enterpriseId);
    setApiMessage(null);
    try {
      const result: EnterpriseApiConnectionTestResult = await settingsApi.testApiEnterprise(enterpriseId);
      const extra = result.reply ? ` Resposta: ${result.reply}` : '';
      setApiMessage({
        type: 'success',
        text: `Teste concluído para empreendimento #${enterpriseId}. Fonte da chave: ${result.apiKeySource ?? 'indefinida'}.${extra}`,
      });
      await loadApiSettings();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao testar conexão do empreendimento.';
      setApiMessage({ type: 'error', text: msg });
      await loadApiSettings();
    } finally {
      setTestingEnterpriseId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-[#3B82F6] border-t-transparent animate-spin mb-3" />
        <p className="text-[13px] text-[#6B7280]">Carregando configurações…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#EF4444"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className="text-[15px] font-medium text-[#111827] mb-1">Erro ao carregar configurações</p>
        <p className="text-[13px] text-[#6B7280] mb-4 max-w-sm text-center">{loadError}</p>
        <Link to="/inbox" className="text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors">
          ← Voltar ao Inbox
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-sm">
        <div className="w-full max-w-none flex items-center gap-4 px-6 lg:px-8 h-14">
          <AppNav />
          <h1 className="text-[15px] font-semibold text-[#111827]">Configurações</h1>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('whatsapp')}
              className={`px-4 py-1.5 rounded-[9px] text-[13px] font-medium transition-colors ${
                activeTab === 'whatsapp'
                  ? 'bg-[#111827] text-white'
                  : 'bg-white text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB]'
              }`}
            >
              WhatsApp
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('api')}
              className={`px-4 py-1.5 rounded-[9px] text-[13px] font-medium transition-colors ${
                activeTab === 'api'
                  ? 'bg-[#111827] text-white'
                  : 'bg-white text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB]'
              }`}
            >
              Configuração de API
            </button>
          </div>
        </div>
      </header>

      <main className="w-full max-w-none px-6 lg:px-8 py-8 space-y-6">
        {activeTab === 'whatsapp' ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            {message && <Alert type={message.type} text={message.text} />}

            <section className={card}>
              <h2 className={sectionH}>Credenciais Meta</h2>
              <div className="space-y-4">
                <label className="block">
                  <span className={lbl}>Token de acesso (Meta)</span>
                  <div className="flex gap-2">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={form.metaAccessTokenInput ?? ''}
                      onChange={(e) => setForm((prev) => ({ ...prev, metaAccessTokenInput: e.target.value }))}
                      placeholder={config?.metaAccessTokenMasked ? '…………………… (deixe em branco para manter)' : 'Cole o token da Meta'}
                      className={`flex-1 ${field}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((prev) => !prev)}
                      className={btnSecondary}
                      style={{ padding: '10px 14px' }}
                    >
                      {showToken ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </div>
                </label>
                <label className="block">
                  <span className={lbl}>Phone Number ID</span>
                  <input
                    type="text"
                    value={form.whatsappPhoneNumberId ?? ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, whatsappPhoneNumberId: e.target.value }))}
                    placeholder="ID do número de telefone no Meta Business"
                    className={field}
                  />
                </label>
                <label className="block">
                  <span className={lbl}>Business Account ID (opcional)</span>
                  <input
                    type="text"
                    value={form.whatsappBusinessAccountId ?? ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, whatsappBusinessAccountId: e.target.value }))}
                    placeholder="ID da conta Business"
                    className={field}
                  />
                </label>
                <label className="block">
                  <span className={lbl}>Versão da API Meta</span>
                  <input
                    type="text"
                    value={form.apiVersion ?? 'v21.0'}
                    onChange={(e) => setForm((prev) => ({ ...prev, apiVersion: e.target.value }))}
                    placeholder="v21.0"
                    className={field}
                  />
                </label>
              </div>
            </section>

            <section className={card}>
              <h2 className={sectionH}>Webhook</h2>
              <label className="block">
                <span className={lbl}>Verify Token</span>
                <div className="flex gap-2">
                  <input
                    type={showWebhookToken ? 'text' : 'password'}
                    value={form.webhookVerifyTokenInput ?? ''}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        webhookVerifyTokenInput: e.target.value,
                      }))
                    }
                    placeholder={
                      config?.webhookVerifyTokenMasked
                        ? '…………………… (deixe em branco para manter)'
                        : 'Token para verificação do webhook'
                    }
                    className={`flex-1 ${field}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowWebhookToken((prev) => !prev)}
                    className={btnSecondary}
                    style={{ padding: '10px 14px' }}
                  >
                    {showWebhookToken ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
              </label>
            </section>

            <section className={card}>
              <h2 className={sectionH}>Envio</h2>
              <div className="space-y-4">
                <label className="block">
                  <span className={lbl}>Número padrão de envio (opcional)</span>
                  <input
                    type="text"
                    value={form.defaultSendPhoneNumber ?? ''}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        defaultSendPhoneNumber: e.target.value.trim() || null,
                      }))
                    }
                    placeholder="Ex: 5511999999999"
                    className={field}
                  />
                </label>
                <label className="block">
                  <span className={lbl}>Código do país padrão (opcional)</span>
                  <input
                    type="text"
                    value={form.defaultCountryCode ?? ''}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, defaultCountryCode: e.target.value.trim() || null }))
                    }
                    placeholder="Ex: 55"
                    className={field}
                  />
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.enabled ?? false}
                    onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                    className="w-4 h-4 rounded border-[#D1D5DB] text-[#3B82F6] focus:ring-[#3B82F6] focus:ring-offset-0"
                  />
                  <span className="text-[14px] font-medium text-[#111827]">Integração ativa</span>
                </label>
              </div>
            </section>

            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={saving} className={btnPrimary}>
                {saving ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Salvando…
                  </>
                ) : (
                  'Salvar WhatsApp'
                )}
              </button>
              <button type="button" onClick={handleTestConnection} disabled={testing} className={btnSecondary}>
                {testing ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-[#9CA3AF] border-t-[#374151] animate-spin" />
                    Verificando…
                  </>
                ) : (
                  'Testar conexão'
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-5">
            {apiMessage && <Alert type={apiMessage.type} text={apiMessage.text} />}
            {apiLoadError && <Alert type="error" text={apiLoadError} />}
            {apiLoading && (
              <section className={card}>
                <div className="flex items-center gap-2 text-[13px] text-[#6B7280]">
                  <span className="h-4 w-4 rounded-full border-2 border-[#9CA3AF] border-t-[#374151] animate-spin" />
                  Carregando configuração de API…
                </div>
              </section>
            )}

            {!apiLoading && hasApiData && (
              <>
                <section className={card}>
                  <h2 className={sectionH}>Configuração global padrão</h2>
                  <p className="text-[13px] text-[#6B7280] mb-4">
                    Quando um empreendimento usa fallback global, a Ana utiliza estes valores como padrão.
                  </p>
                  <form onSubmit={handleSaveGlobalApi} className="space-y-4">
                    <div className="rounded-[10px] border border-[#E5E7EB] bg-[#FAFAFA] px-4 py-3 text-[13px] text-[#4B5563]">
                      <p>
                        API Key atual: <strong>{apiGlobal?.masked_api_key ?? 'não configurada'}</strong>
                      </p>
                      <p>
                        Status da IA global: <strong>{apiGlobal?.ai_enabled ? 'ativa' : 'desativada'}</strong>
                      </p>
                    </div>

                    <label className="block">
                      <span className={lbl}>Nova API Key global (substitui a atual)</span>
                      <div className="flex gap-2">
                        <input
                          type={showGlobalApiKeyInput ? 'text' : 'password'}
                          value={apiGlobalForm.openai_api_key_input}
                          onChange={(e) =>
                            setApiGlobalForm((prev) => ({ ...prev, openai_api_key_input: e.target.value }))
                          }
                          placeholder="Deixe em branco para manter a chave atual"
                          className={`flex-1 ${field}`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowGlobalApiKeyInput((prev) => !prev)}
                          className={btnSecondary}
                          style={{ padding: '10px 14px' }}
                        >
                          {showGlobalApiKeyInput ? 'Ocultar' : 'Mostrar'}
                        </button>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={apiGlobalForm.remove_api_key}
                        onChange={(e) =>
                          setApiGlobalForm((prev) => ({ ...prev, remove_api_key: e.target.checked }))
                        }
                        className="w-4 h-4 rounded border-[#D1D5DB] text-[#3B82F6] focus:ring-[#3B82F6] focus:ring-offset-0"
                      />
                      <span className="text-[14px] text-[#111827]">Remover API Key global (somente ao salvar)</span>
                    </label>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <label className="block">
                        <span className={lbl}>API Key ID</span>
                        <input
                          type="text"
                          value={apiGlobalForm.openai_api_key_id_input}
                          onChange={(e) =>
                            setApiGlobalForm((prev) => ({ ...prev, openai_api_key_id_input: e.target.value }))
                          }
                          className={field}
                          placeholder="key_..."
                        />
                      </label>
                      <label className="block">
                        <span className={lbl}>Project ID</span>
                        <input
                          type="text"
                          value={apiGlobalForm.openai_project_id_input}
                          onChange={(e) =>
                            setApiGlobalForm((prev) => ({ ...prev, openai_project_id_input: e.target.value }))
                          }
                          className={field}
                          placeholder="proj_..."
                        />
                      </label>
                      <label className="block md:col-span-2">
                        <span className={lbl}>Base URL</span>
                        <input
                          type="text"
                          value={apiGlobalForm.openai_base_url_input}
                          onChange={(e) =>
                            setApiGlobalForm((prev) => ({ ...prev, openai_base_url_input: e.target.value }))
                          }
                          className={field}
                          placeholder="https://api.openai.com/v1"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block">
                          <span className={lbl}>Modelo para leads quentes</span>
                          <select
                            value={apiGlobalForm.model_hot_lead_input}
                            onChange={(e) =>
                              setApiGlobalForm((prev) => ({ ...prev, model_hot_lead_input: e.target.value }))
                            }
                            className={field}
                          >
                            <option value="">Selecionar modelo</option>
                            {availableModels.map((model) => (
                              <option key={`global-hot-${model.value}`} value={model.value}>
                                {model.label} - {model.description}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className={lbl}>Modelo para leads frios/triagem</span>
                          <select
                            value={apiGlobalForm.model_cold_lead_input}
                            onChange={(e) =>
                              setApiGlobalForm((prev) => ({ ...prev, model_cold_lead_input: e.target.value }))
                            }
                            className={field}
                          >
                            <option value="">Selecionar modelo</option>
                            {availableModels.map((model) => (
                              <option key={`global-cold-${model.value}`} value={model.value}>
                                {model.label} - {model.description}
                              </option>
                            ))}
                          </select>
                        </label>
                      <label className="block">
                        <span className={lbl}>Temperature</span>
                        <input
                          type="number"
                          min={0}
                          max={2}
                          step={0.1}
                          value={apiGlobalForm.temperature_input}
                          onChange={(e) =>
                            setApiGlobalForm((prev) => ({
                              ...prev,
                              temperature_input: Number.parseFloat(e.target.value) || 0,
                            }))
                          }
                          className={field}
                        />
                      </label>
                      <label className="block">
                        <span className={lbl}>Max tokens</span>
                        <input
                          type="number"
                          min={1}
                          max={4096}
                          value={apiGlobalForm.max_tokens_input}
                          onChange={(e) =>
                            setApiGlobalForm((prev) => ({
                              ...prev,
                              max_tokens_input: Number.parseInt(e.target.value, 10) || 1,
                            }))
                          }
                          className={field}
                        />
                      </label>
                      <label className="block">
                        <span className={lbl}>Lead score threshold</span>
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={apiGlobalForm.lead_score_threshold_input}
                          onChange={(e) =>
                            setApiGlobalForm((prev) => ({
                              ...prev,
                              lead_score_threshold_input: Number.parseFloat(e.target.value) || 0,
                            }))
                          }
                          className={field}
                        />
                      </label>
                    </div>

                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={apiGlobalForm.ai_enabled_input}
                        onChange={(e) =>
                          setApiGlobalForm((prev) => ({ ...prev, ai_enabled_input: e.target.checked }))
                        }
                        className="w-4 h-4 rounded border-[#D1D5DB] text-[#3B82F6] focus:ring-[#3B82F6] focus:ring-offset-0"
                      />
                      <span className="text-[14px] font-medium text-[#111827]">IA global ativa</span>
                    </label>

                    <button type="submit" disabled={savingGlobalApi} className={btnPrimary}>
                      {savingGlobalApi ? (
                        <>
                          <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                          Salvando…
                        </>
                      ) : (
                        'Salvar configuração global'
                      )}
                    </button>
                  </form>
                </section>

                <section className={card}>
                  <h2 className={sectionH}>Configuração por empreendimento</h2>
                  <p className="text-[13px] text-[#6B7280] mb-5">
                    Quando um empreendimento possui API própria, a Ana usa essa chave nas chamadas de IA desse empreendimento. Se a opção de API global estiver ativa, a Ana usa a configuração global como fallback.
                  </p>

                  <div className="space-y-4">
                    {apiEnterpriseItems.map((item) => {
                      const enterpriseForm = apiEnterpriseForms[item.enterprise_id];
                      if (!enterpriseForm) return null;
                      const expanded = expandedEnterpriseId === item.enterprise_id;
                      const savingThis = savingEnterpriseId === item.enterprise_id;
                      const testingThis = testingEnterpriseId === item.enterprise_id;

                      return (
                        <article key={item.enterprise_id} className="rounded-[12px] border border-[#E5E7EB] bg-white overflow-hidden">
                          <div className="px-4 py-4 border-b border-[#F1F5F9] flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
                            <div className="min-w-0 flex-1">
                              <h3 className="text-[15px] font-semibold text-[#111827] truncate">{item.enterprise_name}</h3>
                              <p className="text-[12px] text-[#6B7280] mt-1">
                                Fonte atual da chave: <strong>{item.api_key_source_preview ?? 'bloqueada/indefinida'}</strong>
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`text-[11px] px-2 py-1 rounded-full border ${
                                  item.ai_enabled
                                    ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                                    : 'bg-gray-100 border-gray-200 text-gray-700'
                                }`}
                              >
                                IA {item.ai_enabled ? 'ativa' : 'desativada'}
                              </span>
                              <span
                                className={`text-[11px] px-2 py-1 rounded-full border ${
                                  item.emergency_block_enabled
                                    ? 'bg-red-50 border-red-100 text-red-700'
                                    : 'bg-emerald-50 border-emerald-100 text-emerald-700'
                                }`}
                              >
                                {item.emergency_block_enabled ? 'Bloqueio emergencial ativo' : 'Sem bloqueio emergencial'}
                              </span>
                              <span className="text-[11px] px-2 py-1 rounded-full border bg-slate-50 border-slate-200 text-slate-700">
                                {item.use_global_defaults ? 'Usa fallback global' : 'Somente API própria'}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedEnterpriseId((prev) =>
                                  prev === item.enterprise_id ? null : item.enterprise_id
                                )
                              }
                              className={btnSecondary}
                            >
                              {expanded ? 'Fechar' : 'Editar'}
                            </button>
                          </div>

                          <div className="px-4 py-3 bg-[#FAFAFA] text-[12px] text-[#4B5563] grid grid-cols-1 md:grid-cols-2 gap-2">
                            <p>API própria: <strong>{item.has_own_api_key ? 'sim' : 'não'}</strong></p>
                            <p>API Key mascarada: <strong>{item.masked_api_key ?? 'não configurada'}</strong></p>
                            <p>Último teste: <strong>{formatDateTime(item.last_connection_test_at)}</strong></p>
                            <p>Status do último teste: <strong>{item.last_connection_test_status ?? 'indefinido'}</strong></p>
                            <p>Modelo efetivo quente: <strong>{item.effective_model_hot_lead}</strong></p>
                            <p>Modelo efetivo frio: <strong>{item.effective_model_cold_lead}</strong></p>
                            <p className="md:col-span-2">Custo do período: <strong>indisponível nesta tela (backend preparado por api_key_id)</strong></p>
                          </div>

                          {expanded && (
                            <div className="px-4 py-4 space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <label className="flex items-center gap-3 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={enterpriseForm.use_global_defaults}
                                    onChange={(e) =>
                                      updateEnterpriseForm(item.enterprise_id, (prev) => ({
                                        ...prev,
                                        use_global_defaults: e.target.checked,
                                      }))
                                    }
                                    className="w-4 h-4 rounded border-[#D1D5DB] text-[#3B82F6] focus:ring-[#3B82F6] focus:ring-offset-0"
                                  />
                                  <span className="text-[14px] text-[#111827]">Usar API global padrão (fallback)</span>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={enterpriseForm.ai_enabled}
                                    onChange={(e) =>
                                      updateEnterpriseForm(item.enterprise_id, (prev) => ({
                                        ...prev,
                                        ai_enabled: e.target.checked,
                                      }))
                                    }
                                    className="w-4 h-4 rounded border-[#D1D5DB] text-[#3B82F6] focus:ring-[#3B82F6] focus:ring-offset-0"
                                  />
                                  <span className="text-[14px] text-[#111827]">IA ativa neste empreendimento</span>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={enterpriseForm.emergency_block_enabled}
                                    onChange={(e) =>
                                      updateEnterpriseForm(item.enterprise_id, (prev) => ({
                                        ...prev,
                                        emergency_block_enabled: e.target.checked,
                                      }))
                                    }
                                    className="w-4 h-4 rounded border-[#D1D5DB] text-[#EF4444] focus:ring-[#EF4444] focus:ring-offset-0"
                                  />
                                  <span className="text-[14px] text-[#111827]">Bloqueio emergencial ativo</span>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={enterpriseForm.cost_tracking_enabled}
                                    onChange={(e) =>
                                      updateEnterpriseForm(item.enterprise_id, (prev) => ({
                                        ...prev,
                                        cost_tracking_enabled: e.target.checked,
                                      }))
                                    }
                                    className="w-4 h-4 rounded border-[#D1D5DB] text-[#3B82F6] focus:ring-[#3B82F6] focus:ring-offset-0"
                                  />
                                  <span className="text-[14px] text-[#111827]">Tracking de custo ativo</span>
                                </label>
                              </div>

                              <label className="block">
                                <span className={lbl}>Nova API Key própria OpenAI</span>
                                <input
                                  type="password"
                                  value={enterpriseForm.openai_api_key_input}
                                  onChange={(e) =>
                                    updateEnterpriseForm(item.enterprise_id, (prev) => ({
                                      ...prev,
                                      openai_api_key_input: e.target.value,
                                    }))
                                  }
                                  className={field}
                                  placeholder="Deixe em branco para manter a chave atual"
                                />
                              </label>

                              <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={enterpriseForm.remove_api_key}
                                  onChange={(e) =>
                                    updateEnterpriseForm(item.enterprise_id, (prev) => ({
                                      ...prev,
                                      remove_api_key: e.target.checked,
                                    }))
                                  }
                                  className="w-4 h-4 rounded border-[#D1D5DB] text-[#EF4444] focus:ring-[#EF4444] focus:ring-offset-0"
                                />
                                <span className="text-[14px] text-[#111827]">Remover chave própria (somente ao salvar)</span>
                              </label>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <label className="block">
                                  <span className={lbl}>API Key ID</span>
                                  <input
                                    type="text"
                                    value={enterpriseForm.openai_api_key_id}
                                    onChange={(e) =>
                                      updateEnterpriseForm(item.enterprise_id, (prev) => ({
                                        ...prev,
                                        openai_api_key_id: e.target.value,
                                      }))
                                    }
                                    className={field}
                                  />
                                </label>
                                <label className="block">
                                  <span className={lbl}>Project ID</span>
                                  <input
                                    type="text"
                                    value={enterpriseForm.openai_project_id}
                                    onChange={(e) =>
                                      updateEnterpriseForm(item.enterprise_id, (prev) => ({
                                        ...prev,
                                        openai_project_id: e.target.value,
                                      }))
                                    }
                                    className={field}
                                  />
                                </label>
                                <label className="block md:col-span-2">
                                  <span className={lbl}>Base URL</span>
                                  <input
                                    type="text"
                                    value={enterpriseForm.openai_base_url}
                                    onChange={(e) =>
                                      updateEnterpriseForm(item.enterprise_id, (prev) => ({
                                        ...prev,
                                        openai_base_url: e.target.value,
                                      }))
                                    }
                                    className={field}
                                    placeholder="https://api.openai.com/v1"
                                  />
                                </label>
                                <label className="block">
                                  <span className={lbl}>Modelo para leads quentes</span>
                                  <select
                                    value={enterpriseForm.model_hot_lead}
                                    onChange={(e) =>
                                      updateEnterpriseForm(item.enterprise_id, (prev) => ({
                                        ...prev,
                                        model_hot_lead: e.target.value,
                                      }))
                                    }
                                    className={field}
                                  >
                                    <option value="">Selecionar modelo</option>
                                    {availableModels.map((model) => (
                                      <option key={`enterprise-hot-${item.enterprise_id}-${model.value}`} value={model.value}>
                                        {model.label} - {model.description}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="block">
                                  <span className={lbl}>Modelo para leads frios/triagem</span>
                                  <select
                                    value={enterpriseForm.model_cold_lead}
                                    onChange={(e) =>
                                      updateEnterpriseForm(item.enterprise_id, (prev) => ({
                                        ...prev,
                                        model_cold_lead: e.target.value,
                                      }))
                                    }
                                    className={field}
                                  >
                                    <option value="">Selecionar modelo</option>
                                    {availableModels.map((model) => (
                                      <option key={`enterprise-cold-${item.enterprise_id}-${model.value}`} value={model.value}>
                                        {model.label} - {model.description}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="block md:col-span-2">
                                  <span className={lbl}>Mensagem de bloqueio emergencial</span>
                                  <textarea
                                    value={enterpriseForm.emergency_block_message}
                                    onChange={(e) =>
                                      updateEnterpriseForm(item.enterprise_id, (prev) => ({
                                        ...prev,
                                        emergency_block_message: e.target.value,
                                      }))
                                    }
                                    rows={3}
                                    className={field}
                                    placeholder="Mensagem opcional enviada quando o bloqueio emergencial estiver ativo"
                                  />
                                </label>
                              </div>

                              <div className="flex flex-wrap gap-3 pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleSaveEnterprise(item.enterprise_id)}
                                  disabled={savingThis}
                                  className={btnPrimary}
                                >
                                  {savingThis ? (
                                    <>
                                      <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                                      Salvando…
                                    </>
                                  ) : (
                                    'Salvar'
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleTestEnterprise(item.enterprise_id)}
                                  disabled={testingThis}
                                  className={btnSecondary}
                                >
                                  {testingThis ? (
                                    <>
                                      <span className="h-4 w-4 rounded-full border-2 border-[#9CA3AF] border-t-[#374151] animate-spin" />
                                      Testando…
                                    </>
                                  ) : (
                                    'Testar conexão'
                                  )}
                                </button>
                              </div>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              </>
            )}

            {!apiLoading && !hasApiData && (
              <section className={card}>
                <p className="text-[13px] text-[#6B7280]">Nenhum dado de configuração de API disponível.</p>
              </section>
            )}
          </div>
        )}

        <div className="h-10" />
      </main>
    </div>
  );
}
