import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '../components/AppNav';
import { appointmentsApi, projectsApi, corretoresApi } from '../api/client';
import type { Appointment, AssignAppointmentResult } from '../api/client';

const field =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3.5 py-[10px] text-[14px] leading-5 text-[#111827] placeholder:text-[#9CA3AF] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';
const card = 'bg-white rounded-[12px] border border-[#E5E7EB] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]';
const label = 'block text-[13px] font-medium text-[#6B7280] mb-1.5';
const btnPrimary =
  'inline-flex items-center justify-center text-[14px] font-semibold bg-[#F97316] text-white rounded-[10px] px-6 py-[10px] hover:bg-[#EA580C] active:bg-[#C2410C] disabled:opacity-40 transition-colors shadow-sm';
const btnGhost =
  'inline-flex items-center justify-center text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateForInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function AgendaPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [corretores, setCorretores] = useState<{ id: number; fullName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [filterDate, setFilterDate] = useState('');
  const [filterEnterpriseId, setFilterEnterpriseId] = useState<number | ''>('');
  const [filterBrokerId, setFilterBrokerId] = useState<number | ''>('');
  const [filterStatus, setFilterStatus] = useState('');

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [enterpriseId, setEnterpriseId] = useState<number | ''>('');
  const [brokerId, setBrokerId] = useState<number | ''>('');
  const [city, setCity] = useState('');
  const [dateStr, setDateStr] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [notes, setNotes] = useState('');

  const [assignModalAppointment, setAssignModalAppointment] = useState<Appointment | null>(null);
  const [assignBrokerId, setAssignBrokerId] = useState<number | ''>('');
  const [assignErr, setAssignErr] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [corretoresByEnterprise, setCorretoresByEnterprise] = useState<{ id: number; fullName: string }[]>([]);

  useEffect(() => {
    projectsApi.list(false).then((d) => setProjects(d.projects.map((p) => ({ id: p.id, name: p.name })))).catch(() => setProjects([]));
    corretoresApi.list().then((d) => setCorretores(d.corretores.map((c) => ({ id: c.id, fullName: c.fullName })))).catch(() => setCorretores([]));
  }, []);

  const loadAppointments = useCallback(() => {
    setLoading(true);
    const params: { enterpriseId?: number; brokerId?: number; status?: string; date?: string } = {};
    if (filterEnterpriseId !== '') params.enterpriseId = filterEnterpriseId as number;
    if (filterBrokerId !== '') params.brokerId = filterBrokerId as number;
    if (filterStatus) params.status = filterStatus;
    if (filterDate) params.date = filterDate;
    appointmentsApi
      .list(params)
      .then((d) => setAppointments(d.appointments))
      .catch(() => setAppointments([]))
      .finally(() => setLoading(false));
  }, [filterEnterpriseId, filterBrokerId, filterStatus, filterDate]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  useEffect(() => {
    if (assignModalAppointment) {
      corretoresApi.list({ enterpriseId: assignModalAppointment.enterpriseId }).then((d) => setCorretoresByEnterprise(d.corretores.map((c) => ({ id: c.id, fullName: c.fullName })))).catch(() => setCorretoresByEnterprise([]));
    } else {
      setCorretoresByEnterprise([]);
    }
  }, [assignModalAppointment]);

  const openAssignModal = (a: Appointment) => {
    setAssignModalAppointment(a);
    setAssignBrokerId('');
    setAssignErr(null);
  };
  const closeAssignModal = () => setAssignModalAppointment(null);

  const handleAssignConfirm = () => {
    if (!assignModalAppointment || assignBrokerId === '') return;
    setAssigning(true);
    setAssignErr(null);
    appointmentsApi
      .assignPending(assignModalAppointment.id, assignBrokerId as number)
      .then(() => {
        loadAppointments();
        closeAssignModal();
      })
      .catch((e) => setAssignErr(e instanceof Error ? e.message : 'Erro ao atribuir'))
      .finally(() => setAssigning(false));
  };

  const openNew = () => {
    const today = formatDateForInput(new Date());
    setCustomerName('');
    setCustomerPhone('');
    setEnterpriseId('');
    setBrokerId('');
    setCity('');
    setDateStr(today);
    setStartTime('09:00');
    setEndTime('10:00');
    setNotes('');
    setErr(null);
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

  const save = () => {
    const name = customerName.trim();
    if (!name) {
      setErr('Nome do cliente Ã© obrigatÃ³rio.');
      return;
    }
    const entId = enterpriseId === '' ? null : Number(enterpriseId);
    if (!entId) {
      setErr('Selecione o empreendimento.');
      return;
    }
    if (!dateStr) {
      setErr('Informe a data.');
      return;
    }
    const startAt = new Date(`${dateStr}T${startTime}:00`);
    const endAt = new Date(`${dateStr}T${endTime}:00`);
    if (startAt >= endAt) {
      setErr('Hora inicial deve ser anterior Ã  hora final.');
      return;
    }
    setSaving(true);
    setErr(null);
    appointmentsApi
      .assign({
        customerName: name,
        customerPhone: customerPhone.trim(),
        enterpriseId: entId,
        brokerId: brokerId === '' ? undefined : (brokerId as number),
        city: city.trim(),
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        notes: notes.trim() || undefined,
      })
      .then((res: AssignAppointmentResult) => {
        loadAppointments();
        closeModal();
        if (res.broker) {
          alert(`Agendamento confirmado!\nCorretor: ${res.broker.fullName}\nEmpreendimento: ${res.empreendimento ?? ''}\nData/Hora: ${formatDateTime(res.dataHora)}`);
        } else {
          alert('Agendamento criado com status "Pend. distribuiÃ§Ã£o" â€” nenhum corretor elegÃ­vel no horÃ¡rio. Ajuste a disponibilidade e redistribua manualmente.');
        }
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Erro ao criar agendamento'))
      .finally(() => setSaving(false));
  };

  const handleCancel = (a: Appointment) => {
    if (!confirm(`Cancelar agendamento de ${a.customerName}?`)) return;
    appointmentsApi.updateStatus(a.id, 'CANCELADO').then(() => loadAppointments()).catch(() => {});
  };

  const handleDelete = (a: Appointment) => {
    if (!confirm('Deseja excluir este agendamento?')) return;
    appointmentsApi
      .delete(a.id)
      .then(() => setAppointments((prev) => prev.filter((x) => x.id !== a.id)))
      .catch(() => {});
  };

  const getProjectName = (id: number) => projects.find((p) => p.id === id)?.name ?? `#${id}`;
  const getBrokerName = (id: number | null) => (id ? corretores.find((c) => c.id === id)?.fullName ?? `#${id}` : 'â€”');

  const statusClass: Record<string, string> = {
    CONFIRMADO: 'bg-[#D1FAE5] text-[#059669]',
    PENDENTE_CONFIRMACAO: 'bg-[#FEF3C7] text-[#D97706]',
    PENDENTE_DISTRIBUICAO: 'bg-[#FEE2E2] text-[#B91C1C]',
    CANCELADO: 'bg-[#FEE2E2] text-[#DC2626]',
    REALIZADO: 'bg-[#E0E7FF] text-[#4338CA]',
    NO_SHOW: 'bg-[#F3F4F6] text-[#6B7280]',
  };

  const statusLabel: Record<string, string> = {
    CONFIRMADO: 'Confirmado',
    PENDENTE_CONFIRMACAO: 'Pendente',
    PENDENTE_DISTRIBUICAO: 'Pend. distribuiÃ§Ã£o',
    CANCELADO: 'Cancelado',
    REALIZADO: 'Realizado',
    NO_SHOW: 'No-show',
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-sm">
        <div className="w-full max-w-none flex items-center gap-4 px-6 lg:px-8 h-14">
          <AppNav />
          <h1 className="text-[15px] font-semibold text-[#111827]">Agenda</h1>
        </div>
      </header>

      <div className="w-full max-w-none px-6 lg:px-8 py-8">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
          <p className="text-[13px] text-[#6B7280]">Agendamentos com distribuiÃ§Ã£o automÃ¡tica para corretores.</p>
          <button type="button" onClick={openNew} className={btnPrimary}>
            Novo agendamento
          </button>
        </div>

        <div className={`${card} mb-6`}>
          <h3 className="text-[13px] font-semibold text-[#6B7280] mb-3">Filtros</h3>
          <div className="flex flex-wrap gap-4">
            <label>
              <span className={label}>Data</span>
              <input
                type="date"
                className={field + ' w-40'}
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              />
            </label>
            <label>
              <span className={label}>Empreendimento</span>
              <select
                className={field + ' w-48'}
                value={filterEnterpriseId}
                onChange={(e) => setFilterEnterpriseId(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">Todos</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span className={label}>Corretor</span>
              <select
                className={field + ' w-48'}
                value={filterBrokerId}
                onChange={(e) => setFilterBrokerId(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">Todos</option>
                {corretores.map((c) => (
                  <option key={c.id} value={c.id}>{c.fullName}</option>
                ))}
              </select>
            </label>
            <label>
              <span className={label}>Status</span>
              <select
                className={field + ' w-40'}
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="">Todos</option>
                <option value="CONFIRMADO">Confirmado</option>
                <option value="PENDENTE_CONFIRMACAO">Pendente</option>
                <option value="PENDENTE_DISTRIBUICAO">Pend. distribuiÃ§Ã£o</option>
                <option value="CANCELADO">Cancelado</option>
                <option value="REALIZADO">Realizado</option>
                <option value="NO_SHOW">No-show</option>
              </select>
            </label>
          </div>
        </div>

        <div className={card}>
          {loading ? (
            <div className="flex items-center gap-2 py-8 justify-center">
              <div className="h-5 w-5 rounded-full border-2 border-[#3B82F6] border-t-transparent animate-spin" />
              <span className="text-[13px] text-[#6B7280]">Carregandoâ€¦</span>
            </div>
          ) : appointments.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-[15px] font-medium text-[#111827] mb-1">Nenhum agendamento</p>
              <p className="text-[13px] text-[#6B7280] mb-4">Clique em &quot;Novo agendamento&quot; para comeÃ§ar.</p>
              <button type="button" onClick={openNew} className={btnPrimary}>Novo agendamento</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E5E7EB]">
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">Cliente</th>
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">Telefone</th>
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">Empreendimento</th>
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">Corretor</th>
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">Cidade</th>
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">Data/Hora</th>
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">Status</th>
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">AÃ§Ãµes</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((a) => (
                    <tr key={a.id} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
                      <td className="py-3.5 px-4 text-[14px] font-medium text-[#111827]">{a.customerName}</td>
                      <td className="py-3.5 px-4 text-[13px] text-[#6B7280]">{a.customerPhone || 'â€”'}</td>
                      <td className="py-3.5 px-4 text-[13px] text-[#6B7280]">{getProjectName(a.enterpriseId)}</td>
                      <td className="py-3.5 px-4 text-[13px] text-[#6B7280]">{getBrokerName(a.brokerId)}</td>
                      <td className="py-3.5 px-4 text-[13px] text-[#6B7280]">{a.city || 'â€”'}</td>
                      <td className="py-3.5 px-4 text-[13px] text-[#6B7280]">{formatDateTime(a.startAt)}</td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex text-[11px] font-semibold px-2.5 py-1 rounded-md ${statusClass[a.status] ?? 'bg-[#F3F4F6] text-[#6B7280]'}`}>
                          {statusLabel[a.status] ?? a.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="flex flex-wrap gap-2">
                          {a.status !== 'CANCELADO' && a.status !== 'REALIZADO' && a.status !== 'NO_SHOW' && (
                            <button
                              type="button"
                              onClick={() => handleCancel(a)}
                              className="text-[12px] font-medium text-[#9CA3AF] hover:text-amber-600 transition-colors"
                            >
                              Cancelar
                            </button>
                          )}
                          {a.status === 'PENDENTE_DISTRIBUICAO' && (
                            <button
                              type="button"
                              onClick={() => openAssignModal(a)}
                              className="text-[12px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors"
                            >
                              Atribuir
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDelete(a)}
                            className="text-[12px] font-medium text-[#9CA3AF] hover:text-red-600 transition-colors"
                          >
                            Excluir
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={closeModal}>
          <div className={`${card} w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-semibold text-[#111827] mb-5">Novo agendamento</h2>
            {err && (
              <div className="mb-4 text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-4 py-3">
                {err}
              </div>
            )}
            <div className="space-y-4">
              <label>
                <span className={label}>Nome do cliente</span>
                <input className={field} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Ex.: Maria Silva" />
              </label>
              <label>
                <span className={label}>Telefone</span>
                <input className={field} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Ex.: (11) 99999-9999" />
              </label>
              <label>
                <span className={label}>Empreendimento</span>
                <select className={field} value={enterpriseId} onChange={(e) => setEnterpriseId(e.target.value === '' ? '' : Number(e.target.value))}>
                  <option value="">Selecione</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className={label}>Corretor</span>
                <select className={field} value={brokerId} onChange={(e) => setBrokerId(e.target.value === '' ? '' : Number(e.target.value))}>
                  <option value="">DistribuiÃ§Ã£o automÃ¡tica</option>
                  {corretores.map((c) => (
                    <option key={c.id} value={c.id}>{c.fullName}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className={label}>Cidade</span>
                <input className={field} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex.: SÃ£o Paulo" />
              </label>
              <label>
                <span className={label}>Data</span>
                <input type="date" className={field} value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
              </label>
              <div className="grid grid-cols-2 gap-4">
                <label>
                  <span className={label}>Hora inÃ­cio</span>
                  <input type="time" className={field} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </label>
                <label>
                  <span className={label}>Hora fim</span>
                  <input type="time" className={field} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </label>
              </div>
              <label>
                <span className={label}>ObservaÃ§Ãµes</span>
                <textarea className={field + ' min-h-[80px]'} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
              </label>
            </div>
            <div className="flex gap-3 mt-6">
              <button type="button" onClick={save} disabled={saving} className={btnPrimary}>
                {saving ? 'Salvandoâ€¦' : 'Confirmar agendamento'}
              </button>
              <button type="button" onClick={closeModal} className={btnGhost}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {assignModalAppointment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={closeAssignModal}>
          <div className={`${card} w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-semibold text-[#111827] mb-5">Atribuir corretor</h2>
            <p className="text-[13px] text-[#6B7280] mb-4">
              Agendamento de <strong>{assignModalAppointment.customerName}</strong> em {formatDateTime(assignModalAppointment.startAt)}
            </p>
            {assignErr && (
              <div className="mb-4 text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-4 py-3">
                {assignErr}
              </div>
            )}
            <label>
              <span className={label}>Corretor</span>
              <select
                className={field}
                value={assignBrokerId}
                onChange={(e) => setAssignBrokerId(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">Selecione o corretor</option>
                {corretoresByEnterprise.map((c) => (
                  <option key={c.id} value={c.id}>{c.fullName}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-3 mt-6">
              <button type="button" onClick={handleAssignConfirm} disabled={assigning || assignBrokerId === ''} className={btnPrimary}>
                {assigning ? 'Atribuindoâ€¦' : 'Confirmar atribuiÃ§Ã£o'}
              </button>
              <button type="button" onClick={closeAssignModal} className={btnGhost}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

