import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { dashboardApi, projectsApi, type DashboardOverview, type DashboardPeriod } from '../api/client';
import { formatDurationSeconds } from '../utils/format';

const card =
  'bg-white rounded-[12px] border border-[#F0F2F5] p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)]';
const heading = 'text-[16px] font-semibold text-[#111827] mb-1';
const sub = 'text-[13px] text-[#9CA3AF] mb-5';
const selectField =
  'border border-[#E5E7EB] rounded-[10px] px-3.5 py-[10px] text-[14px] text-[#111827] bg-white focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];

/** Parte 9: azul volume, verde qualificado, laranja (handoff/transição), roxo carteira */
const CLASS_COLORS: Record<string, string> = {
  Novo: 'bg-[#60A5FA]',
  Qualificado: 'bg-[#34D399]',
  Handoff: 'bg-[#FB923C]',
  Carteira: 'bg-[#A78BFA]',
};

function KpiCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className={`${card} p-5`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1">{title}</p>
      <p className="text-[26px] font-semibold text-[#111827] tabular-nums leading-tight">{value}</p>
      {hint && <p className="text-[11px] text-[#9CA3AF] mt-2 leading-snug">{hint}</p>}
    </div>
  );
}

function TimelineChart({ data }: { data: DashboardOverview['timeline'] }) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.newConversations)), [data]);
  const w = 640;
  const h = 200;
  const pad = 12;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const n = data.length;
  const step = n <= 1 ? 0 : innerW / (n - 1);

  const pointsConv = data.map((d, i) => {
    const x = n <= 1 ? pad + innerW / 2 : pad + i * step;
    const y = pad + innerH - (d.newConversations / max) * innerH;
    return `${x},${y}`;
  });

  return (
    <div className="w-full overflow-x-auto">
      <svg width={w} height={h} className="mx-auto block" viewBox={`0 0 ${w} ${h}`}>
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#E8ECF1" strokeWidth={1} />
        <polyline
          fill="none"
          stroke="#3B82F6"
          strokeWidth={2.25}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={pointsConv.join(' ')}
        />
      </svg>
      <div className="flex flex-wrap justify-center gap-4 mt-2 text-[11px] text-[#6B7280]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-[#3B82F6] rounded" /> Novas conversas por dia (created_at, America/São Paulo)
        </span>
      </div>
      <div className="flex justify-between mt-3 text-[10px] text-[#9CA3AF] px-1">
        {data.length > 0 && (
          <>
            <span>{data[0]?.date}</span>
            <span>{data[data.length - 1]?.date}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('7d');
  const [enterpriseId, setEnterpriseId] = useState<number | ''>('');
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvErr, setCsvErr] = useState<string | null>(null);

  const loadProjects = useCallback(() => {
    projectsApi
      .list(false)
      .then((d) => setProjects((d.projects || []).map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProjects([]));
  }, []);

  const loadOverview = useCallback(() => {
    setLoading(true);
    setErr(null);
    dashboardApi
      .overview({
        period,
        enterpriseId: enterpriseId === '' ? undefined : enterpriseId,
      })
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Erro ao carregar'))
      .finally(() => setLoading(false));
  }, [period, enterpriseId]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handleExportCsv = useCallback(async () => {
    setCsvLoading(true);
    setCsvErr(null);
    try {
      const { blob, filename } = await dashboardApi.downloadCsv({
        period,
        enterpriseId: enterpriseId === '' ? undefined : enterpriseId,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setCsvErr(e instanceof Error ? e.message : 'Não foi possível exportar o CSV. Tente de novo.');
    } finally {
      setCsvLoading(false);
    }
  }, [period, enterpriseId]);

  const classMax = useMemo(
    () => Math.max(1, ...(data?.classification.map((c) => c.count) ?? [1])),
    [data]
  );

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-sm">
        <div className="max-w-[1200px] mx-auto flex items-center gap-4 px-6 h-14">
          <AppNav />
          <h1 className="text-[15px] font-semibold text-[#111827]">Dashboard</h1>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-6">
        <div className={`${card} py-4 px-5`}>
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-4">
            <label className="block sm:min-w-[200px]">
              <span className="block text-[12px] font-medium text-[#6B7280] mb-1">Período</span>
              <select
                className={`${selectField} w-full sm:w-auto min-w-[180px]`}
                value={period}
                onChange={(e) => setPeriod(e.target.value as DashboardPeriod)}
              >
                {PERIOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1 min-w-[200px]">
              <span className="block text-[12px] font-medium text-[#6B7280] mb-1">Empreendimento</span>
              <select
                className={`${selectField} w-full max-w-md`}
                value={enterpriseId === '' ? 'all' : enterpriseId}
                onChange={(e) => {
                  const v = e.target.value;
                  setEnterpriseId(v === 'all' ? '' : Number(v));
                }}
              >
                <option value="all">Todos</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-2 sm:self-end">
              <button
                type="button"
                onClick={() => void handleExportCsv()}
                disabled={csvLoading}
                className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 rounded-[10px] text-[14px] font-semibold bg-[#111827] text-white hover:bg-[#1F2937] disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                {csvLoading ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Exportando…
                  </>
                ) : (
                  'Exportar CSV'
                )}
              </button>
              {csvErr && <p className="text-[12px] text-red-600 max-w-xs">{csvErr}</p>}
            </div>
          </div>
          <p className="text-[12px] text-[#9CA3AF] mt-3 leading-relaxed">
            <strong className="text-[#6B7280] font-medium">Carteira:</strong> contato sem avanço no momento, mas com potencial de retomada
            futura — não indica descarte ou spam.
          </p>
        </div>

        {err && (
          <div className="rounded-[10px] border border-red-100 bg-red-50 text-[13px] text-red-700 px-4 py-3">{err}</div>
        )}

        {loading && !data ? (
          <div className={`${card} flex items-center justify-center gap-3 py-16`}>
            <div className="h-6 w-6 rounded-full border-2 border-[#3B82F6] border-t-transparent animate-spin" />
            <span className="text-[#6B7280] text-[14px]">Carregando indicadores…</span>
          </div>
        ) : data ? (
          <>
            <section>
              <h2 className={heading}>Indicadores</h2>
              <p className={sub}>
                Handoff e demais funis usam apenas o campo <strong>classification</strong> (não a flag <code className="text-[12px]">handoff</code>).
                Estado <strong>atual</strong> no filtro, exceto &quot;Novas conversas hoje&quot; (dia em America/São Paulo) e o gráfico (período
                selecionado).
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard title="Novas conversas hoje" value={data.kpis.newConversationsToday} hint="created_at no dia (America/São Paulo)" />
                <KpiCard
                  title="Conversas ativas agora"
                  value={data.kpis.activeConversations}
                  hint="Classificação Novo ou Qualificado (exclui Carteira e Handoff)"
                />
                <KpiCard title="Qualificados atuais" value={data.kpis.qualified} />
                <KpiCard title="Handoffs atuais" value={data.kpis.handoffs} />
                <KpiCard title="Carteira atual" value={data.kpis.carteira} />
                <KpiCard
                  title="Tempo médio de primeira resposta"
                  value={formatDurationSeconds(data.kpis.avgFirstResponseSeconds)}
                  hint="Entre conversation.created_at e MIN(message.created_at) com role assistant"
                />
                <KpiCard
                  title="Sem primeira resposta"
                  value={data.kpis.noFirstResponse}
                  hint="Existe mensagem user e não existe mensagem assistant"
                />
              </div>
            </section>

            <div className="grid lg:grid-cols-2 gap-6">
              <section className={card}>
                <h2 className={heading}>Evolução por dia</h2>
                <p className={sub}>Novas conversas por dia (conversations.created_at, fuso America/São Paulo).</p>
                {data.timeline.length === 0 ? (
                  <p className="text-[13px] text-[#9CA3AF]">Sem dados no período.</p>
                ) : (
                  <TimelineChart data={data.timeline} />
                )}
              </section>

              <section className={card}>
                <h2 className={heading}>Distribuição atual dos leads</h2>
                <p className={sub}>
                  Snapshot do estado <strong>atual</strong> (sem filtro de período). Contagem só pela <strong>classification</strong> atual — sem
                  histórico.
                </p>
                <ul className="space-y-4">
                  {data.classification.map((row) => (
                    <li key={row.label}>
                      <div className="flex justify-between text-[13px] mb-1">
                        <span className="font-medium text-[#374151]">{row.label}</span>
                        <span className="tabular-nums text-[#6B7280]">{row.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[#F3F4F6] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${CLASS_COLORS[row.label] ?? 'bg-[#9CA3AF]'}`}
                          style={{ width: `${Math.min(100, (row.count / classMax) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <section className={card}>
              <h2 className={heading}>Desempenho por empreendimento</h2>
              <p className={sub}>Visão <strong>atual</strong> por empreendimento (totais e classificações no estado de hoje).</p>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] text-left">
                  <thead>
                    <tr className="border-b border-[#E5E7EB] text-[11px] uppercase tracking-wide text-[#9CA3AF]">
                      <th className="py-3 pr-4 font-semibold">Empreendimento</th>
                      <th className="py-3 pr-4 font-semibold text-right">Total</th>
                      <th className="py-3 pr-4 font-semibold text-right">Qualif.</th>
                      <th className="py-3 pr-4 font-semibold text-right">Handoff</th>
                      <th className="py-3 font-semibold text-right">Carteira</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.enterprises.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-[#9CA3AF] text-center">
                          Nenhuma conversa com o filtro atual.
                        </td>
                      </tr>
                    ) : (
                      data.enterprises.map((row) => (
                        <tr key={`${row.enterpriseId ?? 'null'}-${row.name}`} className="border-b border-[#F3F4F6] last:border-0">
                          <td className="py-3 pr-4 text-[#111827] font-medium">{row.name}</td>
                          <td className="py-3 pr-4 text-right tabular-nums">{row.total}</td>
                          <td className="py-3 pr-4 text-right tabular-nums">{row.qualified}</td>
                          <td className="py-3 pr-4 text-right tabular-nums">{row.handoffs}</td>
                          <td className="py-3 text-right tabular-nums">{row.carteiras}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={card}>
              <h2 className={heading}>Itens que exigem atenção</h2>
              <p className={sub}>
                Calculadas sempre no backend; com filtro por empreendimento, &quot;Novo sem projeto&quot; deixa de aparecer naturalmente (sem
                enterprise). Inclui: sem primeira resposta, novo sem projeto, conversas paradas (Novo/Qualificado, última atividade &gt; 24h).
              </p>
              {data.attentionItems.length === 0 ? (
                <p className="text-[13px] text-[#9CA3AF]">Nenhum item listado no momento.</p>
              ) : (
                <ul className="divide-y divide-[#F3F4F6]">
                  {data.attentionItems.map((item) => (
                    <li key={`${item.id}-${item.reason}`} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <p className="text-[14px] font-medium text-[#111827]">
                          {item.customerName?.trim() || 'Sem nome'}
                          <span className="text-[12px] font-normal text-[#9CA3AF] ml-2">#{item.id}</span>
                        </p>
                        <p className="text-[12px] text-[#6B7280] mt-0.5">{item.reason}</p>
                        {item.enterpriseName && (
                          <p className="text-[11px] text-[#9CA3AF] mt-1">{item.enterpriseName}</p>
                        )}
                      </div>
                      <Link
                        to={`/inbox?conversationId=${item.id}`}
                        className="shrink-0 text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8]"
                      >
                        Ir à Inbox →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
