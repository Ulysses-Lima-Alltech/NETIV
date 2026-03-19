import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import {
  settingsApi,
  projectsApi,
  type WhatsAppConfigPublic,
  type WhatsAppConfigUpdate,
  type AIConfigPublic,
  type AIConfigUpdate,
  type ProjectListItem,
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
  const styles = type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100';
  return (
    <div className={`flex items-start gap-2 text-[13px] rounded-[10px] border px-4 py-3 ${styles}`}>
      {type === 'success' ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      )}
      {text}
    </div>
  );
}

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
    metaAccessTokenInput: '', whatsappPhoneNumberId: '', whatsappBusinessAccountId: '', apiVersion: 'v21.0', webhookVerifyTokenInput: '', defaultSendPhoneNumber: null, defaultCountryCode: null, enabled: false,
  });
  const [showToken, setShowToken] = useState(false);
  const [showWebhookToken, setShowWebhookToken] = useState(false);
  const [aiForm, setAiForm] = useState<AIConfigUpdate & { openaiApiKeyInput?: string }>({
    openaiApiKeyInput: '', openaiBaseUrl: null, modelColdLead: 'gpt-4', modelHotLead: 'gpt-4o', temperature: 0.4, maxTokens: 500, leadScoreThreshold: 0.75, aiEnabled: false,
  });
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
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
          const d = whatsappResult.value;
          setConfig(d);
          setForm((f) => ({ ...f, whatsappPhoneNumberId: d.whatsappPhoneNumberId, whatsappBusinessAccountId: d.whatsappBusinessAccountId, apiVersion: d.apiVersion, defaultSendPhoneNumber: d.defaultSendPhoneNumber, defaultCountryCode: d.defaultCountryCode, enabled: d.enabled, metaAccessTokenInput: '', webhookVerifyTokenInput: '' }));
        } else { setLoadError(whatsappResult.reason?.message ?? 'Erro ao carregar configurações do WhatsApp.'); }
        if (aiResult.status === 'fulfilled') {
          const d = aiResult.value;
          setAiConfig(d);
          setAiForm((f) => ({ ...f, openaiBaseUrl: d.openaiBaseUrl, modelColdLead: d.modelColdLead, modelHotLead: d.modelHotLead, temperature: d.temperature, maxTokens: d.maxTokens, leadScoreThreshold: d.leadScoreThreshold, aiEnabled: d.aiEnabled, openaiApiKeyInput: '' }));
        } else { setAiMessage({ type: 'error', text: aiResult.reason?.message ?? 'Erro ao carregar configurações de IA.' }); }
        if (whatsappResult.status === 'rejected' && aiResult.status === 'rejected') {
          setLoadError(whatsappResult.reason?.message ?? aiResult.reason?.message ?? 'Erro ao carregar configurações.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setProjectsLoading(true);
    projectsApi.list(false).then((data) => setProjects(data.projects)).catch(() => setProjects([])).finally(() => setProjectsLoading(false));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setMessage(null);
    const payload: WhatsAppConfigUpdate = { whatsappPhoneNumberId: form.whatsappPhoneNumberId || undefined, whatsappBusinessAccountId: form.whatsappBusinessAccountId || undefined, apiVersion: form.apiVersion || undefined, defaultSendPhoneNumber: form.defaultSendPhoneNumber ?? undefined, defaultCountryCode: form.defaultCountryCode ?? undefined, enabled: form.enabled };
    if (form.metaAccessTokenInput) payload.metaAccessToken = form.metaAccessTokenInput;
    if (form.webhookVerifyTokenInput) payload.webhookVerifyToken = form.webhookVerifyTokenInput;
    settingsApi.putWhatsApp(payload)
      .then((data) => { setConfig(data); setForm((f) => ({ ...f, metaAccessTokenInput: '', webhookVerifyTokenInput: '' })); setMessage({ type: 'success', text: 'Configurações salvas com sucesso.' }); })
      .catch((err: Error) => { setMessage({ type: 'error', text: err.message ?? 'Erro ao salvar.' }); })
      .finally(() => setSaving(false));
  };

  const handleTestConnection = () => {
    setTesting(true); setMessage(null);
    settingsApi.testWhatsApp()
      .then((data) => { setMessage({ type: 'success', text: data.message ?? 'Conexão com a Meta validada com sucesso.' }); })
      .catch((err: Error) => { setMessage({ type: 'error', text: err.message ?? 'Erro ao verificar.' }); })
      .finally(() => setTesting(false));
  };

  const handleSubmitAI = (e: React.FormEvent) => {
    e.preventDefault(); setAiSaving(true); setAiMessage(null);
    const payload: AIConfigUpdate = { openaiBaseUrl: aiForm.openaiBaseUrl === '' ? null : aiForm.openaiBaseUrl, modelColdLead: aiForm.modelColdLead, modelHotLead: aiForm.modelHotLead, temperature: aiForm.temperature, maxTokens: aiForm.maxTokens, leadScoreThreshold: aiForm.leadScoreThreshold, aiEnabled: aiForm.aiEnabled };
    if (aiForm.openaiApiKeyInput) payload.openaiApiKey = aiForm.openaiApiKeyInput;
    settingsApi.putAI(payload)
      .then((data) => { setAiConfig(data); setAiForm((f) => ({ ...f, openaiApiKeyInput: '' })); setAiMessage({ type: 'success', text: 'Configurações de IA salvas com sucesso.' }); })
      .catch((err: Error) => { setAiMessage({ type: 'error', text: err.message ?? 'Erro ao salvar.' }); })
      .finally(() => setAiSaving(false));
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
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <p className="text-[15px] font-medium text-[#111827] mb-1">Erro ao carregar configurações</p>
        <p className="text-[13px] text-[#6B7280] mb-4 max-w-sm text-center">{loadError}</p>
        <Link to="/inbox" className="text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors">← Voltar ao Inbox</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-sm">
        <div className="max-w-[800px] mx-auto flex items-center gap-4 px-6 h-14">
          <AppNav />
          <h1 className="text-[15px] font-semibold text-[#111827]">Configurações</h1>
        </div>
      </header>

      <main className="max-w-[800px] mx-auto px-6 py-8 space-y-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {message && <Alert type={message.type} text={message.text} />}

          <section className={card}>
            <h2 className={sectionH}>Credenciais Meta</h2>
            <div className="space-y-4">
              <label className="block">
                <span className={lbl}>Token de acesso (Meta)</span>
                <div className="flex gap-2">
                  <input type={showToken ? 'text' : 'password'} value={form.metaAccessTokenInput ?? ''} onChange={(e) => setForm((f) => ({ ...f, metaAccessTokenInput: e.target.value }))} placeholder={config?.metaAccessTokenMasked ? '•••••••• (deixe em branco para manter)' : 'Cole o token da Meta'} className={`flex-1 ${field}`} />
                  <button type="button" onClick={() => setShowToken((s) => !s)} className={btnSecondary} style={{ padding: '10px 14px' }}>{showToken ? 'Ocultar' : 'Mostrar'}</button>
                </div>
              </label>
              <label className="block"><span className={lbl}>Phone Number ID</span><input type="text" value={form.whatsappPhoneNumberId ?? ''} onChange={(e) => setForm((f) => ({ ...f, whatsappPhoneNumberId: e.target.value }))} placeholder="ID do número de telefone no Meta Business" className={field} /></label>
              <label className="block"><span className={lbl}>Business Account ID (opcional)</span><input type="text" value={form.whatsappBusinessAccountId ?? ''} onChange={(e) => setForm((f) => ({ ...f, whatsappBusinessAccountId: e.target.value }))} placeholder="ID da conta Business" className={field} /></label>
              <label className="block"><span className={lbl}>Versão da API Meta</span><input type="text" value={form.apiVersion ?? 'v21.0'} onChange={(e) => setForm((f) => ({ ...f, apiVersion: e.target.value }))} placeholder="v21.0" className={field} /></label>
            </div>
          </section>

          <section className={card}>
            <h2 className={sectionH}>Webhook</h2>
            <label className="block">
              <span className={lbl}>Verify Token</span>
              <div className="flex gap-2">
                <input type={showWebhookToken ? 'text' : 'password'} value={form.webhookVerifyTokenInput ?? ''} onChange={(e) => setForm((f) => ({ ...f, webhookVerifyTokenInput: e.target.value }))} placeholder={config?.webhookVerifyTokenMasked ? '•••••••• (deixe em branco para manter)' : 'Token para verificação do webhook'} className={`flex-1 ${field}`} />
                <button type="button" onClick={() => setShowWebhookToken((s) => !s)} className={btnSecondary} style={{ padding: '10px 14px' }}>{showWebhookToken ? 'Ocultar' : 'Mostrar'}</button>
              </div>
            </label>
          </section>

          <section className={card}>
            <h2 className={sectionH}>Envio</h2>
            <div className="space-y-4">
              <label className="block"><span className={lbl}>Número padrão de envio (opcional)</span><input type="text" value={form.defaultSendPhoneNumber ?? ''} onChange={(e) => setForm((f) => ({ ...f, defaultSendPhoneNumber: e.target.value.trim() || null }))} placeholder="Ex: 5511999999999" className={field} /></label>
              <label className="block"><span className={lbl}>Código do país padrão (opcional)</span><input type="text" value={form.defaultCountryCode ?? ''} onChange={(e) => setForm((f) => ({ ...f, defaultCountryCode: e.target.value.trim() || null }))} placeholder="Ex: 55" className={field} /></label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.enabled ?? false} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} className="w-4 h-4 rounded border-[#D1D5DB] text-[#3B82F6] focus:ring-[#3B82F6] focus:ring-offset-0" />
                <span className="text-[14px] font-medium text-[#111827]">Integração ativa</span>
              </label>
            </div>
          </section>

          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={saving} className={btnPrimary}>
              {saving ? <><span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />Salvando…</> : 'Salvar WhatsApp'}
            </button>
            <button type="button" onClick={handleTestConnection} disabled={testing} className={btnSecondary}>
              {testing ? <><span className="h-4 w-4 rounded-full border-2 border-[#9CA3AF] border-t-[#374151] animate-spin" />Verificando…</> : 'Testar conexão'}
            </button>
          </div>
        </form>

        <section className={card}>
          <h2 className={sectionH}>Projetos</h2>
          <p className="text-[13px] text-[#9CA3AF] -mt-3 mb-5">Empreendimentos usados na classificação das conversas na Inbox.</p>
          {projectMessage && <div className="mb-4"><Alert type={projectMessage.type} text={projectMessage.text} /></div>}
          <div className="flex gap-2 mb-5">
            <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Nome do novo projeto" className={`flex-1 ${field}`} />
            <button type="button" onClick={() => {
              const name = newProjectName.trim(); if (!name) return; setProjectMessage(null);
              projectsApi.create({ name }).then(() => { setNewProjectName(''); setProjectMessage({ type: 'success', text: 'Projeto criado.' }); return projectsApi.list(false); }).then((data) => setProjects(data.projects)).catch((err: Error) => setProjectMessage({ type: 'error', text: err.message ?? 'Erro ao criar.' }));
            }} disabled={!newProjectName.trim()} className={btnPrimary}>Adicionar</button>
          </div>
          {projectsLoading ? (
            <div className="flex items-center gap-2 py-4"><div className="h-4 w-4 rounded-full border-2 border-[#3B82F6] border-t-transparent animate-spin" /><span className="text-[13px] text-[#6B7280]">Carregando…</span></div>
          ) : projects.length === 0 ? (
            <p className="text-[13px] text-[#9CA3AF] py-2">Nenhum projeto cadastrado.</p>
          ) : (
            <ul className="divide-y divide-[#F3F4F6]">
              {projects.map((p) => (
                <li key={p.id} className="py-3 flex items-center gap-3">
                  {editingProjectId === p.id ? (
                    <>
                      <input type="text" value={editingProjectName} onChange={(e) => setEditingProjectName(e.target.value)} className={`flex-1 ${field}`} autoFocus />
                      <button type="button" onClick={() => {
                        const name = editingProjectName.trim(); if (!name) return;
                        projectsApi.update(p.id, { name }).then(() => { setEditingProjectId(null); setEditingProjectName(''); setProjectMessage({ type: 'success', text: 'Projeto atualizado.' }); return projectsApi.list(false); }).then((data) => setProjects(data.projects)).catch((err: Error) => setProjectMessage({ type: 'error', text: err.message ?? 'Erro ao atualizar.' }));
                      }} className="text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors">Salvar</button>
                      <button type="button" onClick={() => { setEditingProjectId(null); setEditingProjectName(''); }} className="text-[13px] font-medium text-[#6B7280] hover:text-[#374151] transition-colors">Cancelar</button>
                    </>
                  ) : (
                    <>
                      <span className={`flex-1 text-[14px] font-medium ${p.status !== 'ativo' ? 'text-[#9CA3AF]' : 'text-[#111827]'}`}>
                        {p.name}{p.status !== 'ativo' && <span className="ml-2 text-[10px] font-medium text-[#9CA3AF] bg-[#F3F4F6] rounded px-1.5 py-px">inativo</span>}
                      </span>
                      {p.status === 'ativo' && <button type="button" onClick={() => { setEditingProjectId(p.id); setEditingProjectName(p.name); setProjectMessage(null); }} className="text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors">Editar</button>}
                      {p.status === 'ativo' && <button type="button" onClick={() => {
                        if (!window.confirm(`Inativar "${p.name}"? Conversas já classificadas manterão a referência.`)) return; setProjectMessage(null);
                        projectsApi.delete(p.id).then(() => { setProjectMessage({ type: 'success', text: 'Projeto inativado.' }); return projectsApi.list(false); }).then((data) => setProjects(data.projects)).catch((err: Error) => setProjectMessage({ type: 'error', text: err.message ?? 'Erro ao inativar.' }));
                      }} className="text-[13px] font-medium text-red-500 hover:text-red-700 transition-colors">Inativar</button>}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <form onSubmit={handleSubmitAI} className="space-y-5">
          {aiMessage && <Alert type={aiMessage.type} text={aiMessage.text} />}
          <section className={card}>
            <h2 className={sectionH}>OpenAI</h2>
            <div className="space-y-4">
              <label className="block">
                <span className={lbl}>API Key</span>
                <div className="flex gap-2">
                  <input type={showOpenAIKey ? 'text' : 'password'} value={aiForm.openaiApiKeyInput ?? ''} onChange={(e) => setAiForm((f) => ({ ...f, openaiApiKeyInput: e.target.value }))} placeholder={aiConfig?.openaiApiKeyMasked ? '•••••••• (deixe em branco para manter)' : 'Cole a chave da API OpenAI'} className={`flex-1 ${field}`} />
                  <button type="button" onClick={() => setShowOpenAIKey((s) => !s)} className={btnSecondary} style={{ padding: '10px 14px' }}>{showOpenAIKey ? 'Ocultar' : 'Mostrar'}</button>
                </div>
              </label>
              <label className="block"><span className={lbl}>Base URL (opcional)</span><input type="text" value={aiForm.openaiBaseUrl ?? ''} onChange={(e) => setAiForm((f) => ({ ...f, openaiBaseUrl: e.target.value.trim() || null }))} placeholder="https://api.openai.com/v1" className={field} /></label>
            </div>
          </section>
          <section className={card}>
            <h2 className={sectionH}>Modelos</h2>
            <div className="space-y-4">
              <label className="block"><span className={lbl}>Modelo conversa inicial (cold lead)</span><input type="text" value={aiForm.modelColdLead ?? ''} onChange={(e) => setAiForm((f) => ({ ...f, modelColdLead: e.target.value }))} placeholder="gpt-4" className={field} /></label>
              <label className="block"><span className={lbl}>Modelo lead quente (hot lead)</span><input type="text" value={aiForm.modelHotLead ?? ''} onChange={(e) => setAiForm((f) => ({ ...f, modelHotLead: e.target.value }))} placeholder="gpt-4o" className={field} /></label>
            </div>
          </section>
          <section className={card}>
            <h2 className={sectionH}>Parâmetros</h2>
            <div className="space-y-4">
              <label className="block"><span className={lbl}>Temperature (0–2)</span><input type="number" min={0} max={2} step={0.1} value={aiForm.temperature ?? 0.4} onChange={(e) => setAiForm((f) => ({ ...f, temperature: parseFloat(e.target.value) || 0.4 }))} className={field} /></label>
              <label className="block"><span className={lbl}>Max tokens</span><input type="number" min={1} max={4096} value={aiForm.maxTokens ?? 500} onChange={(e) => setAiForm((f) => ({ ...f, maxTokens: parseInt(e.target.value, 10) || 500 }))} className={field} /></label>
              <label className="block"><span className={lbl}>Lead score threshold (0–1)</span><input type="number" min={0} max={1} step={0.05} value={aiForm.leadScoreThreshold ?? 0.75} onChange={(e) => setAiForm((f) => ({ ...f, leadScoreThreshold: parseFloat(e.target.value) || 0.75 }))} className={field} /></label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={aiForm.aiEnabled ?? false} onChange={(e) => setAiForm((f) => ({ ...f, aiEnabled: e.target.checked }))} className="w-4 h-4 rounded border-[#D1D5DB] text-[#3B82F6] focus:ring-[#3B82F6] focus:ring-offset-0" />
                <span className="text-[14px] font-medium text-[#111827]">IA ativa</span>
              </label>
            </div>
          </section>
          <button type="submit" disabled={aiSaving} className={btnPrimary}>
            {aiSaving ? <><span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />Salvando…</> : 'Salvar IA'}
          </button>
        </form>
        <div className="h-10" />
      </main>
    </div>
  );
}
