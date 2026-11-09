import { useEffect, useState, type FormEvent } from 'react';
import {
  settingsApi,
  type UnclassifiedLeadFollowupPreview,
  type UnclassifiedLeadFollowupTemplate,
} from '../api/client';

export function UnclassifiedLeadMessageCard() {
  const [text, setText] = useState('');
  const [followUpText, setFollowUpText] = useState('');
  const [savedFollowUpText, setSavedFollowUpText] = useState('');
  const [defaultMessage, setDefaultMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [templateReload, setTemplateReload] = useState(0);
  const [templates, setTemplates] = useState<UnclassifiedLeadFollowupTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [preview, setPreview] = useState<UnclassifiedLeadFollowupPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [campaignResult, setCampaignResult] = useState<{
    total: number;
    sent: number;
    failed: number;
    skipped: number;
    status: string;
    alreadyProcessed?: boolean;
  } | null>(null);
  const [campaignRequestId, setCampaignRequestId] = useState('');

  const followUpIsSaved =
    followUpText.trim().length > 0 && followUpText.trim() === savedFollowUpText;

  useEffect(() => {
    let cancelled = false;

    settingsApi.getUnclassifiedLeads()
      .then((data) => {
        if (cancelled) return;
        setText(data.initialMessage ?? '');
        setFollowUpText(data.followUpMessage ?? '');
        setSavedFollowUpText(data.followUpMessage ?? '');
        setDefaultMessage(data.defaultMessage);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Não foi possível carregar a mensagem.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    settingsApi.getUnclassifiedLeadFollowupTemplates()
      .then(({ templates: items }) => {
        if (!cancelled) {
          setTemplates(items);
          setTemplatesError('');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTemplatesError(error instanceof Error ? error.message : 'Não foi possível carregar os templates.');
        }
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateReload]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || saving || loadError) return;

    setSaving(true);
    setFeedback('');
    setFailed(false);
    const initialMessage = text.trim() || null;
    const followUpMessage = followUpText.trim() || null;

    try {
      const saved = await settingsApi.putUnclassifiedLeads({ initialMessage, followUpMessage });
      const reloaded = await settingsApi.getUnclassifiedLeads();
      if (
        saved.initialMessage !== initialMessage ||
        saved.followUpMessage !== followUpMessage ||
        reloaded.initialMessage !== initialMessage ||
        reloaded.followUpMessage !== followUpMessage
      ) {
        throw new Error('O servidor não confirmou as mensagens salvas.');
      }
      setText(reloaded.initialMessage ?? '');
      setFollowUpText(reloaded.followUpMessage ?? '');
      setSavedFollowUpText(reloaded.followUpMessage ?? '');
      setDefaultMessage(reloaded.defaultMessage);
      setPreview(null);
      setConsentConfirmed(false);
      setCampaignResult(null);
      setFeedback('Mensagens salvas. As mudanças valem para os próximos turnos.');
    } catch (error) {
      setFailed(true);
      setFeedback(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  }

  async function loadPreview() {
    if (!templateKey || !followUpIsSaved || previewing || sending) return;
    setPreviewing(true);
    setPreview(null);
    setConsentConfirmed(false);
    setCampaignResult(null);
    setFeedback('');
    try {
      const result = await settingsApi.previewUnclassifiedLeadFollowup(templateKey);
      setPreview(result);
      setCampaignRequestId(crypto.randomUUID());
    } catch (error) {
      setFailed(true);
      setFeedback(error instanceof Error ? error.message : 'Não foi possível gerar a prévia.');
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmAndSend() {
    if (
      !preview ||
      !campaignRequestId ||
      !templateKey ||
      !followUpIsSaved ||
      !consentConfirmed ||
      sending ||
      (preview.serviceTextCount > 0 && !preview.followUpMessageConfigured)
    ) return;
    const confirmed = window.confirm(
      `Confirmar o Follow-Up para ${preview.total} leads sem empreendimento? ` +
      `${preview.serviceTextCount} receberão texto livre dentro da janela de 24h e ` +
      `${preview.marketingTemplateCount} receberão o template de Marketing aprovado.`
    );
    if (!confirmed) return;

    setSending(true);
    setFeedback('');
    setCampaignResult(null);
    try {
      const result = await settingsApi.sendUnclassifiedLeadFollowup({
        requestId: campaignRequestId,
        templateKey,
        previewFingerprint: preview.previewFingerprint,
        confirmed: true,
        consentConfirmed: true,
      });
      setCampaignResult(result);
      setPreview(null);
      setFeedback(
        result.alreadyProcessed
          ? 'Esta campanha já foi processada; nenhuma mensagem foi reenviada.'
          : 'Campanha finalizada.'
      );
    } catch (error) {
      setFailed(true);
      setFeedback(error instanceof Error ? error.message : 'Não foi possível disparar o Follow-Up.');
    } finally {
      setSending(false);
    }
  }

  const button =
    'rounded-[10px] border border-[#F97316] bg-white px-5 py-2.5 font-bold text-[#F97316] hover:bg-[#FFF7ED] disabled:cursor-not-allowed disabled:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F97316]';
  const field =
    'w-full rounded-[10px] border border-[#F97316] bg-white px-3.5 py-3 text-sm text-black placeholder:text-black focus:outline-none focus:ring-2 focus:ring-[#FDBA74]';

  return (
    <section
      aria-labelledby="unclassified-lead-title"
      className="relative mt-8 rounded-[12px] border-2 border-[#F97316] bg-white p-6 pl-9 text-black"
    >
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 w-2 rounded-l-[10px] bg-[#F97316]"
      />
      <h2 id="unclassified-lead-title" className="mb-3 text-[16px] font-bold uppercase text-black">
        TRATAR LEADS SEM CLASSIFICAÇÃO
      </h2>
      <p className="mb-4 text-sm text-black">
        Usada na triagem de leads sem empreendimento identificado. A Ana continua ativa
        para identificar a cidade e o empreendimento.
      </p>
      {loading ? (
        <p role="status" className="text-black">Carregando mensagem…</p>
      ) : loadError ? (
        <div>
          <p role="alert" className="mb-3 text-black">{loadError}</p>
          <button
            type="button"
            className={button}
            onClick={() => {
              setLoading(true);
              setLoadError('');
              setReload((value) => value + 1);
            }}
          >
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          <form onSubmit={save} className="space-y-4">
            <label htmlFor="unclassified-lead-message" className="block text-sm font-semibold text-black">
              Mensagem inicial
            </label>
            <textarea
              id="unclassified-lead-message"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={5}
              maxLength={2000}
              disabled={saving || previewing || sending}
              aria-describedby="unclassified-lead-help"
              className={field}
              placeholder="Deixe vazio para usar a mensagem padrão atual."
            />
            <p id="unclassified-lead-help" className="text-sm text-black">
              Use {'{cidades}'} para inserir as cidades dos empreendimentos ativos.
              Campo vazio mantém a mensagem padrão antiga, que menciona um corretor,
              mas este recurso não cria um HandOff automaticamente.
            </p>
            <p className="text-sm text-black">{text.length}/2000 caracteres</p>
            <details className="rounded-lg border border-[#FDBA74] bg-white p-3 text-black">
              <summary className="cursor-pointer font-semibold text-black">
                Ver mensagem padrão
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm text-black">{defaultMessage}</p>
            </details>

            <div className="rounded-[10px] border border-[#FDBA74] bg-white p-4">
              <h3 className="mb-2 text-sm font-bold text-black">
                Follow-Up de Leads Não Classificados (Sem Empreendimento)
              </h3>
              <p className="mb-3 text-sm text-black">
                Essa opção permite disparar mensagem para os Leads sem empreendimento que já entraram em contato antes.
              </p>
              <p className="mb-3 text-sm font-semibold text-black">
                OBJETIVO: Classificar esses Leads → Vincular a um Empreendimento → Filtrar corretamente para Controle → Manter o Lead Quente
              </p>
              <label htmlFor="unclassified-lead-followup-message" className="mb-1.5 block text-sm font-semibold text-black">
                Mensagem livre para leads dentro da janela de 24 horas
              </label>
              <textarea
                id="unclassified-lead-followup-message"
                value={followUpText}
              onChange={(event) => {
                setFollowUpText(event.target.value);
                setPreview(null);
                setConsentConfirmed(false);
                setCampaignResult(null);
                }}
                rows={4}
                maxLength={2000}
                disabled={saving || previewing || sending}
                className={field}
                placeholder="Defina aqui o texto automático para conversas com janela aberta."
              />
              <p className="mt-1 text-sm text-black">
                Você pode usar {'{cidades}'}. Campo vazio deixa o disparo desativado.
                Fora das 24 horas, o envio usa o template de Marketing aprovado abaixo.
              </p>
              <p className="mt-2 text-sm text-black">
                A Meta pode cobrar mensagens de serviço após a franquia mensal gratuita; templates de Marketing são cobrados por mensagem entregue.
              </p>
              <p className="mt-1 text-sm text-black">{followUpText.length}/2000 caracteres</p>
              {!followUpIsSaved && followUpText.trim() && (
                <p className="mt-2 text-sm font-semibold text-black">
                  Salve esta mensagem antes de gerar a prévia.
                </p>
              )}
            </div>

            {feedback && (
              <p role={failed ? 'alert' : 'status'} className="text-sm font-semibold text-black">
                {feedback}
              </p>
            )}
            <button type="submit" className={button} disabled={saving || previewing || sending}>
              {saving ? 'Salvando…' : 'Salvar mensagens'}
            </button>
          </form>

          <div className="mt-5 space-y-4 rounded-[10px] border border-[#FDBA74] bg-white p-4 text-black">
            <label htmlFor="unclassified-lead-followup-template" className="block text-sm font-semibold text-black">
              Template de Marketing aprovado pela Meta (leads fora da janela de 24 horas)
            </label>
            <select
              id="unclassified-lead-followup-template"
              value={templateKey}
              onChange={(event) => {
                setTemplateKey(event.target.value);
                setPreview(null);
                setConsentConfirmed(false);
                setCampaignResult(null);
              }}
              disabled={templatesLoading || previewing || sending}
              className={field}
            >
              <option value="">Selecione um template aprovado</option>
              {templates.map((template) => (
                <option key={`${template.key}:${template.languageCode}`} value={template.key}>
                  {template.name} ({template.languageCode})
                </option>
              ))}
            </select>
            {templatesLoading && <p role="status" className="text-sm text-black">Carregando templates…</p>}
            {templatesError && (
              <div>
                <p role="alert" className="text-sm font-semibold text-black">{templatesError}</p>
                <button
                  type="button"
                  className={button}
                  onClick={() => {
                    setTemplatesLoading(true);
                    setTemplateReload((value) => value + 1);
                  }}
                >
                  Atualizar templates
                </button>
              </div>
            )}
            {!templatesLoading && templates.length === 0 && (
              <p className="text-sm text-black">
                Nenhum template simples de Marketing aprovado foi encontrado. Sincronize/aprove um template na Meta para habilitar leads antigos.
              </p>
            )}
            {templateKey && (
              <details className="rounded-lg border border-[#FDBA74] bg-[#FFF7ED] p-3">
                <summary className="cursor-pointer text-sm font-semibold text-black">Ver corpo do template</summary>
                <p className="mt-2 whitespace-pre-wrap text-sm text-black">
                  {templates.find((template) => template.key === templateKey)?.body}
                </p>
              </details>
            )}
            <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={button}
              disabled={
                !templateKey ||
                !followUpIsSaved ||
                previewing ||
                sending ||
                (preview != null && (!consentConfirmed || preview.total === 0))
              }
              onClick={() => {
                if (preview) void confirmAndSend();
                else void loadPreview();
              }}
            >
              {previewing ? 'Gerando prévia…' : sending ? 'Enviando…' : 'Confirmar e Disparar Follow-Up'}
            </button>
          </div>
          <p className="text-sm text-black">
            O botão primeiro atualiza a prévia. Revise a lista, confirme o consentimento e clique novamente para autorizar o disparo.
          </p>
          {preview && (
              <div className="space-y-3" aria-live="polite">
                <p className="text-sm font-semibold text-black">
                  Prévia: {preview.total} leads — {preview.serviceTextCount} com janela aberta e {preview.marketingTemplateCount} com template de Marketing.
                </p>
                {preview.total === 0 && (
                  <p className="text-sm text-black">
                    Não há conversas elegíveis: o lead precisa estar sem empreendimento, ativo e ter uma mensagem recebida.
                  </p>
                )}
                {!preview.followUpMessageConfigured && (
                  <p className="text-sm font-semibold text-black">
                    Salve a mensagem livre antes de enviar este Follow-Up.
                  </p>
                )}
                {preview.serviceTextPreview && (
                  <div className="rounded-lg border border-[#FDBA74] bg-white p-3">
                    <p className="mb-1 text-sm font-semibold text-black">Texto livre (janela aberta)</p>
                    <p className="whitespace-pre-wrap text-sm text-black">{preview.serviceTextPreview}</p>
                  </div>
                )}
                {preview.marketingTemplateCount > 0 && (
                  <p className="text-sm text-black">
                    Leads antigos receberão o template selecionado acima.
                  </p>
                )}
                <div className="max-h-64 overflow-y-auto rounded-lg border border-[#FDBA74]">
                  <ul className="divide-y divide-[#FDBA74]">
                    {preview.leads.map((lead) => (
                      <li key={lead.conversationId} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm text-black">
                        <span>{lead.customerName?.trim() || 'Lead'} · {lead.phoneMasked}</span>
                        <span>{lead.deliveryType === 'SERVICE_TEXT' ? 'Janela aberta (24h)' : 'Template Meta'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <label className="flex items-start gap-2 text-sm text-black">
                  <input
                    type="checkbox"
                    checked={consentConfirmed}
                    onChange={(event) => setConsentConfirmed(event.target.checked)}
                    className="mt-1 accent-[#F97316]"
                  />
                  <span>
                    Confirmo que os leads desta prévia autorizaram receber comunicações de acompanhamento pelo WhatsApp.
                  </span>
                </label>
              </div>
            )}
            {campaignResult && (
              <p role="status" className="text-sm font-semibold text-black">
                Campanha {campaignResult.status}: {campaignResult.sent} enviados, {campaignResult.failed} falhas e {campaignResult.skipped} ignorados.
                {campaignResult.alreadyProcessed ? ' Nenhum lead foi reenviado.' : ''}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
