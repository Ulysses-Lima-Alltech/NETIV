import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  settingsApi,
  projectsApi,
  type WhatsAppConfigPublic,
  type WhatsAppConfigUpdate,
  type AIConfigPublic,
  type AIConfigUpdate,
  type ProjectItem,
} from '../api/client';

export function SettingsWhatsAppPage() {
  const [config, setConfig] = useState<WhatsAppConfigPublic | null>(null);
  const [aiConfig, setAiConfig] = useState<AIConfigPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [aiMessage, setAiMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<WhatsAppConfigUpdate & { metaAccessTokenInput?: string; webhookVerifyTokenInput?: string }>({
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
  const [aiForm, setAiForm] = useState<AIConfigUpdate & { openaiApiKeyInput?: string }>({
    openaiApiKeyInput: '',
    openaiBaseUrl: null,
    modelColdLead: 'gpt-4',
    modelHotLead: 'gpt-4o',
    temperature: 0.4,
    maxTokens: 500,
    leadScoreThreshold: 0.75,
    aiEnabled: false,
  });
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectMessage, setProjectMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([settingsApi.getWhatsApp(), settingsApi.getAI()])
      .then(([whatsappResult, aiResult]) => {
        if (cancelled) return;
        if (whatsappResult.status === 'fulfilled') {
          const whatsappData = whatsappResult.value;
          setConfig(whatsappData);
          setForm((f) => ({
            ...f,
            whatsappPhoneNumberId: whatsappData.whatsappPhoneNumberId,
            whatsappBusinessAccountId: whatsappData.whatsappBusinessAccountId,
            apiVersion: whatsappData.apiVersion,
            defaultSendPhoneNumber: whatsappData.defaultSendPhoneNumber,
            defaultCountryCode: whatsappData.defaultCountryCode,
            enabled: whatsappData.enabled,
            metaAccessTokenInput: '',
            webhookVerifyTokenInput: '',
          }));
        } else {
          setLoadError(whatsappResult.reason?.message ?? 'Erro ao carregar configurações do WhatsApp.');
        }
        if (aiResult.status === 'fulfilled') {
          const aiData = aiResult.value;
          setAiConfig(aiData);
          setAiForm((f) => ({
            ...f,
            openaiBaseUrl: aiData.openaiBaseUrl,
            modelColdLead: aiData.modelColdLead,
            modelHotLead: aiData.modelHotLead,
            temperature: aiData.temperature,
            maxTokens: aiData.maxTokens,
            leadScoreThreshold: aiData.leadScoreThreshold,
            aiEnabled: aiData.aiEnabled,
            openaiApiKeyInput: '',
          }));
        } else {
          setAiMessage({ type: 'error', text: aiResult.reason?.message ?? 'Erro ao carregar configurações de IA.' });
        }
        if (whatsappResult.status === 'rejected' && aiResult.status === 'rejected') {
          setLoadError(whatsappResult.reason?.message ?? aiResult.reason?.message ?? 'Erro ao carregar configurações.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setProjectsLoading(true);
    projectsApi
      .list(false)
      .then((data) => setProjects(data.projects))
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoading(false));
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
        setForm((f) => ({ ...f, metaAccessTokenInput: '', webhookVerifyTokenInput: '' }));
        setMessage({ type: 'success', text: 'Configurações salvas com sucesso.' });
      })
      .catch((err: Error) => {
        setMessage({ type: 'error', text: err.message ?? 'Erro ao salvar.' });
      })
      .finally(() => setSaving(false));
  };

  const handleTestConnection = () => {
    setTesting(true);
    setMessage(null);
    settingsApi
      .testWhatsApp()
      .then((data) => {
        setMessage({
          type: 'success',
          text: data.message ?? 'Conexão com a Meta validada com sucesso.',
        });
      })
      .catch((err: Error) => {
        setMessage({ type: 'error', text: err.message ?? 'Erro ao verificar.' });
      })
      .finally(() => setTesting(false));
  };

  const handleSubmitAI = (e: React.FormEvent) => {
    e.preventDefault();
    setAiSaving(true);
    setAiMessage(null);
    const payload: AIConfigUpdate = {
      openaiBaseUrl: aiForm.openaiBaseUrl === '' ? null : aiForm.openaiBaseUrl,
      modelColdLead: aiForm.modelColdLead,
      modelHotLead: aiForm.modelHotLead,
      temperature: aiForm.temperature,
      maxTokens: aiForm.maxTokens,
      leadScoreThreshold: aiForm.leadScoreThreshold,
      aiEnabled: aiForm.aiEnabled,
    };
    if (aiForm.openaiApiKeyInput) payload.openaiApiKey = aiForm.openaiApiKeyInput;
    settingsApi
      .putAI(payload)
      .then((data) => {
        setAiConfig(data);
        setAiForm((f) => ({ ...f, openaiApiKeyInput: '' }));
        setAiMessage({ type: 'success', text: 'Configurações de IA salvas com sucesso.' });
      })
      .catch((err: Error) => {
        setAiMessage({ type: 'error', text: err.message ?? 'Erro ao salvar.' });
      })
      .finally(() => setAiSaving(false));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-gray-500">Carregando...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <p className="text-red-600 font-medium mb-2">Erro ao carregar configurações</p>
          <p className="text-gray-700 text-sm mb-4">{loadError}</p>
          <Link to="/inbox" className="text-sm text-blue-600 hover:text-blue-800">
            ← Voltar ao Inbox
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="border-b border-gray-200 px-4 py-3 flex items-center gap-4">
        <Link
          to="/inbox"
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          ← Voltar
        </Link>
        <h1 className="text-lg font-semibold">Configurações</h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Configurações</h2>
          <p className="text-base font-semibold text-gray-900 mt-1">Integrações</p>
        </div>

        <section className="mb-10">
          <h3 className="text-sm font-medium text-gray-700 mb-3">WhatsApp</h3>
        </section>

        <form onSubmit={handleSubmit} className="space-y-6">
          {message && (
            <div
              className={`p-3 rounded-lg text-sm ${
                message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              }`}
            >
              {message.text}
            </div>
          )}

          <section className="border border-gray-200 rounded-lg p-4 space-y-4">
            <h3 className="text-sm font-medium text-gray-900">Credenciais Meta</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Token de acesso (Meta)</label>
              <div className="flex gap-2">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={form.metaAccessTokenInput ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, metaAccessTokenInput: e.target.value }))}
                  placeholder={config?.metaAccessTokenMasked ? '•••••••• (deixe em branco para manter)' : 'Cole o token da Meta'}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((s) => !s)}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
                  aria-label={showToken ? 'Ocultar token' : 'Mostrar token'}
                >
                  {showToken ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number ID</label>
              <input
                type="text"
                value={form.whatsappPhoneNumberId ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, whatsappPhoneNumberId: e.target.value }))}
                placeholder="ID do número de telefone no Meta Business"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Account ID (opcional)</label>
              <input
                type="text"
                value={form.whatsappBusinessAccountId ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, whatsappBusinessAccountId: e.target.value }))}
                placeholder="ID da conta Business"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Versão da API Meta</label>
              <input
                type="text"
                value={form.apiVersion ?? 'v21.0'}
                onChange={(e) => setForm((f) => ({ ...f, apiVersion: e.target.value }))}
                placeholder="v21.0"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </section>

          <section className="border border-gray-200 rounded-lg p-4 space-y-4">
            <h3 className="text-sm font-medium text-gray-900">Webhook</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Verify Token (webhook)</label>
              <div className="flex gap-2">
                <input
                  type={showWebhookToken ? 'text' : 'password'}
                  value={form.webhookVerifyTokenInput ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, webhookVerifyTokenInput: e.target.value }))}
                  placeholder={config?.webhookVerifyTokenMasked ? '•••••••• (deixe em branco para manter)' : 'Token para verificação do webhook'}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowWebhookToken((s) => !s)}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  {showWebhookToken ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>
          </section>

          <section className="border border-gray-200 rounded-lg p-4 space-y-4">
            <h3 className="text-sm font-medium text-gray-900">Envio</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Número padrão de envio (opcional)</label>
              <input
                type="text"
                value={form.defaultSendPhoneNumber ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    defaultSendPhoneNumber: e.target.value.trim() || null,
                  }))
                }
                placeholder="Ex: 5511999999999"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Código do país padrão (opcional)</label>
              <input
                type="text"
                value={form.defaultCountryCode ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    defaultCountryCode: e.target.value.trim() || null,
                  }))
                }
                placeholder="Ex: 55"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.enabled ?? false}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Integração ativa</span>
            </label>
          </section>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing}
              className="px-4 py-2 border border-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {testing ? 'Verificando...' : 'Testar conexão'}
            </button>
          </div>
        </form>

        <hr className="my-10 border-gray-200" />

        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-700">Projetos</h3>
          <p className="text-xs text-gray-500 mt-0.5">Empreendimentos usados na classificação das conversas na Inbox.</p>
        </div>
        <section className="border border-gray-200 rounded-lg p-4 space-y-4 mb-10">
          {projectMessage && (
            <div
              className={`p-3 rounded-lg text-sm ${
                projectMessage.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              }`}
            >
              {projectMessage.text}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Nome do novo projeto"
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => {
                const name = newProjectName.trim();
                if (!name) return;
                setProjectMessage(null);
                projectsApi
                  .create(name)
                  .then(() => {
                    setNewProjectName('');
                    setProjectMessage({ type: 'success', text: 'Projeto criado.' });
                    return projectsApi.list(false);
                  })
                  .then((data) => setProjects(data.projects))
                  .catch((err: Error) => setProjectMessage({ type: 'error', text: err.message ?? 'Erro ao criar.' }));
              }}
              disabled={!newProjectName.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50"
            >
              Adicionar
            </button>
          </div>
          <ul className="divide-y divide-gray-200">
            {projectsLoading ? (
              <li className="py-3 text-sm text-gray-500">Carregando...</li>
            ) : projects.length === 0 ? (
              <li className="py-3 text-sm text-gray-500">Nenhum projeto cadastrado.</li>
            ) : (
              projects.map((p) => (
                <li key={p.id} className="py-3 flex items-center gap-3">
                  {editingProjectId === p.id ? (
                    <>
                      <input
                        type="text"
                        value={editingProjectName}
                        onChange={(e) => setEditingProjectName(e.target.value)}
                        className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const name = editingProjectName.trim();
                          if (!name) return;
                          projectsApi
                            .update(p.id, { name })
                            .then(() => {
                              setEditingProjectId(null);
                              setEditingProjectName('');
                              setProjectMessage({ type: 'success', text: 'Projeto atualizado.' });
                              return projectsApi.list(false);
                            })
                            .then((data) => setProjects(data.projects))
                            .catch((err: Error) => setProjectMessage({ type: 'error', text: err.message ?? 'Erro ao atualizar.' }));
                        }}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingProjectId(null);
                          setEditingProjectName('');
                        }}
                        className="text-sm text-gray-500 hover:text-gray-700"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <span className={`flex-1 text-sm font-medium ${!p.active ? 'text-gray-400' : 'text-gray-900'}`}>
                        {p.name}
                        {!p.active && ' (inativo)'}
                      </span>
                      {p.active && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProjectId(p.id);
                            setEditingProjectName(p.name);
                            setProjectMessage(null);
                          }}
                          className="text-sm text-blue-600 hover:text-blue-800"
                        >
                          Editar
                        </button>
                      )}
                      {p.active ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm(`Inativar "${p.name}"? Conversas já classificadas manterão a referência.`)) return;
                            setProjectMessage(null);
                            projectsApi
                              .delete(p.id)
                              .then(() => {
                                setProjectMessage({ type: 'success', text: 'Projeto inativado.' });
                                return projectsApi.list(false);
                              })
                              .then((data) => setProjects(data.projects))
                              .catch((err: Error) => setProjectMessage({ type: 'error', text: err.message ?? 'Erro ao inativar.' }));
                          }}
                          className="text-sm text-red-600 hover:text-red-800"
                        >
                          Inativar
                        </button>
                      ) : null}
                    </>
                  )}
                </li>
              ))
            )}
          </ul>
        </section>

        <hr className="my-10 border-gray-200" />

        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-700">Inteligência Artificial</h3>
        </div>
        <form onSubmit={handleSubmitAI} className="space-y-6">
          {aiMessage && (
            <div
              className={`p-3 rounded-lg text-sm ${
                aiMessage.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              }`}
            >
              {aiMessage.text}
            </div>
          )}
          <section className="border border-gray-200 rounded-lg p-4 space-y-4">
            <h4 className="text-sm font-medium text-gray-900">OpenAI</h4>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">OpenAI API Key</label>
              <div className="flex gap-2">
                <input
                  type={showOpenAIKey ? 'text' : 'password'}
                  value={aiForm.openaiApiKeyInput ?? ''}
                  onChange={(e) => setAiForm((f) => ({ ...f, openaiApiKeyInput: e.target.value }))}
                  placeholder={aiConfig?.openaiApiKeyMasked ? '•••••••• (deixe em branco para manter)' : 'Cole a chave da API OpenAI'}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowOpenAIKey((s) => !s)}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  {showOpenAIKey ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Base URL (opcional)</label>
              <input
                type="text"
                value={aiForm.openaiBaseUrl ?? ''}
                onChange={(e) => setAiForm((f) => ({ ...f, openaiBaseUrl: e.target.value.trim() || null }))}
                placeholder="https://api.openai.com/v1"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </section>
          <section className="border border-gray-200 rounded-lg p-4 space-y-4">
            <h4 className="text-sm font-medium text-gray-900">Modelos</h4>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Modelo conversa inicial (cold lead)</label>
              <input
                type="text"
                value={aiForm.modelColdLead ?? ''}
                onChange={(e) => setAiForm((f) => ({ ...f, modelColdLead: e.target.value }))}
                placeholder="gpt-4"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Modelo lead quente (hot lead)</label>
              <input
                type="text"
                value={aiForm.modelHotLead ?? ''}
                onChange={(e) => setAiForm((f) => ({ ...f, modelHotLead: e.target.value }))}
                placeholder="gpt-4o"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </section>
          <section className="border border-gray-200 rounded-lg p-4 space-y-4">
            <h4 className="text-sm font-medium text-gray-900">Parâmetros</h4>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Temperature (0–2)</label>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={aiForm.temperature ?? 0.4}
                onChange={(e) => setAiForm((f) => ({ ...f, temperature: parseFloat(e.target.value) || 0.4 }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max tokens</label>
              <input
                type="number"
                min={1}
                max={4096}
                value={aiForm.maxTokens ?? 500}
                onChange={(e) => setAiForm((f) => ({ ...f, maxTokens: parseInt(e.target.value, 10) || 500 }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lead score threshold (0–1)</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={aiForm.leadScoreThreshold ?? 0.75}
                onChange={(e) => setAiForm((f) => ({ ...f, leadScoreThreshold: parseFloat(e.target.value) || 0.75 }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={aiForm.aiEnabled ?? false}
                onChange={(e) => setAiForm((f) => ({ ...f, aiEnabled: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">IA ativa</span>
            </label>
          </section>
          <button
            type="submit"
            disabled={aiSaving}
            className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            {aiSaving ? 'Salvando...' : 'Salvar IA'}
          </button>
        </form>
      </main>
    </div>
  );
}
