import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  corretoresApi,
  projectsApi,
  type Corretor,
  type BrokerAvailability,
} from "../api/client";

const field =
  "w-full border border-[#E5E7EB] rounded-[10px] px-3.5 py-[10px] text-[14px] leading-5 text-[#111827] placeholder:text-[#9CA3AF] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none";
const card =
  "bg-white rounded-[12px] border border-[#E5E7EB] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]";
const label = "block text-[13px] font-medium text-[#6B7280] mb-1.5";
const btnPrimary =
  "inline-flex items-center justify-center text-[14px] font-semibold bg-[#F97316] text-white rounded-[10px] px-6 py-[10px] hover:bg-[#EA580C] active:bg-[#C2410C] disabled:opacity-40 transition-colors shadow-sm";
const btnGhost =
  "inline-flex items-center justify-center text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function CorretoresPage() {
  const [list, setList] = useState<Corretor[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [fullName, setFullName] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [realEstateAgency, setRealEstateAgency] = useState("");
  const [active, setActive] = useState(true);
  const [selectedEnterpriseIds, setSelectedEnterpriseIds] = useState<number[]>(
    [],
  );
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [availability, setAvailability] = useState<BrokerAvailability[]>([]);
  const [draftSlots, setDraftSlots] = useState<
    { weekday: number; startTime: string; endTime: string }[]
  >([]);
  const [newSlotWeekday, setNewSlotWeekday] = useState(1);
  const [newSlotStart, setNewSlotStart] = useState("09:00");
  const [newSlotEnd, setNewSlotEnd] = useState("18:00");
  const [editingSlotId, setEditingSlotId] = useState<number | null>(null);
  const [editSlotWeekday, setEditSlotWeekday] = useState(1);
  const [editSlotStart, setEditSlotStart] = useState("09:00");
  const [editSlotEnd, setEditSlotEnd] = useState("18:00");
  const [editSlotActive, setEditSlotActive] = useState(true);

  const HORARIO_COMERCIAL: {
    weekday: number;
    startTime: string;
    endTime: string;
  }[] = [
    { weekday: 1, startTime: "09:00", endTime: "18:00" }, // seg
    { weekday: 2, startTime: "09:00", endTime: "18:00" }, // ter
    { weekday: 3, startTime: "09:00", endTime: "18:00" }, // qua
    { weekday: 4, startTime: "09:00", endTime: "18:00" }, // qui
    { weekday: 5, startTime: "09:00", endTime: "18:00" }, // sex
  ];

  useEffect(() => {
    projectsApi
      .list(false)
      .then((d) =>
        setProjects(d.projects.map((p) => ({ id: p.id, name: p.name }))),
      )
      .catch(() => setProjects([]));
  }, []);

  const loadList = useCallback(() => {
    setLoading(true);
    corretoresApi
      .list()
      .then((d) => setList(d.corretores))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (editingId != null && modalOpen) {
      corretoresApi
        .getAvailability(editingId)
        .then((d) => setAvailability(d.availability))
        .catch(() => setAvailability([]));
      setEditingSlotId(null);
    } else {
      setAvailability([]);
    }
  }, [editingId, modalOpen]);

  const addSlot = () => {
    if (editingId == null) return;
    const st =
      newSlotStart.length === 5 ? newSlotStart : newSlotStart.slice(0, 5);
    const et = newSlotEnd.length === 5 ? newSlotEnd : newSlotEnd.slice(0, 5);
    corretoresApi
      .createAvailability(editingId, {
        weekday: newSlotWeekday,
        startTime: st,
        endTime: et,
        active: true,
      })
      .then(() =>
        corretoresApi
          .getAvailability(editingId)
          .then((d) => setAvailability(d.availability)),
      )
      .catch(() => {});
  };

  const startEditSlot = (s: BrokerAvailability) => {
    setEditingSlotId(s.id);
    setEditSlotWeekday(s.weekday);
    setEditSlotStart(s.startTime.slice(0, 5));
    setEditSlotEnd(s.endTime.slice(0, 5));
    setEditSlotActive(s.active);
  };

  const saveEditSlot = () => {
    if (editingId == null || editingSlotId == null) return;
    corretoresApi
      .updateAvailability(editingId, editingSlotId, {
        weekday: editSlotWeekday,
        startTime: editSlotStart,
        endTime: editSlotEnd,
        active: editSlotActive,
      })
      .then(() => {
        corretoresApi
          .getAvailability(editingId!)
          .then((d) => setAvailability(d.availability));
        setEditingSlotId(null);
      })
      .catch(() => {});
  };

  const removeSlot = (availabilityId: number) => {
    if (editingId == null || !confirm("Remover este horário?")) return;
    corretoresApi
      .deleteAvailability(editingId, availabilityId)
      .then(() =>
        corretoresApi
          .getAvailability(editingId)
          .then((d) => setAvailability(d.availability)),
      )
      .catch(() => {});
  };

  const applyHorarioComercial = () => {
    if (editingId != null) {
      Promise.all(
        HORARIO_COMERCIAL.map((s) =>
          corretoresApi.createAvailability(editingId, {
            weekday: s.weekday,
            startTime: s.startTime,
            endTime: s.endTime,
            active: true,
          }),
        ),
      )
        .then(() =>
          corretoresApi
            .getAvailability(editingId!)
            .then((d) => setAvailability(d.availability)),
        )
        .catch(() => {});
    } else {
      setDraftSlots([...HORARIO_COMERCIAL]);
    }
  };

  const addDraftSlot = () => {
    setDraftSlots((prev) => [
      ...prev,
      {
        weekday: newSlotWeekday,
        startTime: newSlotStart.slice(0, 5),
        endTime: newSlotEnd.slice(0, 5),
      },
    ]);
  };

  const removeDraftSlot = (idx: number) => {
    setDraftSlots((prev) => prev.filter((_, i) => i !== idx));
  };

  const openNew = () => {
    setEditingId(null);
    setFullName("");
    setCity("");
    setPhone("");
    setRealEstateAgency("");
    setActive(true);
    setSelectedEnterpriseIds([]);
    setDraftSlots([{ weekday: 1, startTime: "09:00", endTime: "18:00" }]);
    setErr(null);
    setModalOpen(true);
  };

  const openEdit = (c: Corretor) => {
    setEditingId(c.id);
    setFullName(c.fullName);
    setCity(c.city || "");
    setPhone(c.phone || "");
    setRealEstateAgency(c.realEstateAgency || "");
    setActive(c.active);
    setSelectedEnterpriseIds(c.enterpriseIds ?? []);
    setErr(null);
    setModalOpen(true);
  };

  const toggleEnterprise = (id: number) => {
    setSelectedEnterpriseIds((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id],
    );
  };

  const closeModal = () => {
    setModalOpen(false);
  };

  const save = () => {
    const n = fullName.trim();
    if (!n) {
      setErr("Nome completo é obrigatório.");
      return;
    }
    setSaving(true);
    setErr(null);
    if (editingId != null) {
      corretoresApi
        .update(editingId, {
          fullName: n,
          city: city.trim(),
          phone: phone.trim(),
          realEstateAgency: realEstateAgency.trim(),
          active,
          enterpriseIds: selectedEnterpriseIds,
        })
        .then(() => {
          loadList();
          closeModal();
        })
        .catch((e) => setErr(e instanceof Error ? e.message : "Erro ao salvar"))
        .finally(() => setSaving(false));
    } else {
      corretoresApi
        .create({
          fullName: n,
          city: city.trim(),
          phone: phone.trim(),
          realEstateAgency: realEstateAgency.trim(),
          enterpriseIds: selectedEnterpriseIds,
        })
        .then(async (created) => {
          if (draftSlots.length > 0) {
            const results = await Promise.allSettled(
              draftSlots.map((s) =>
                corretoresApi.createAvailability(created.id, {
                  weekday: s.weekday,
                  startTime: s.startTime,
                  endTime: s.endTime,
                  active: true,
                }),
              ),
            );
            results.forEach((r, i) => {
              if (r.status === "rejected") {
                console.warn(
                  "[CorretoresPage] Falha ao criar horário",
                  draftSlots[i],
                  r.reason,
                );
              }
            });
          }
        })
        .then(() => {
          loadList();
          closeModal();
        })
        .catch((e) =>
          setErr(e instanceof Error ? e.message : "Erro ao cadastrar"),
        )
        .finally(() => setSaving(false));
    }
  };

  const handleInactivate = (id: number) => {
    if (!confirm("Inativar este corretor?")) return;
    corretoresApi
      .inactivate(id)
      .then(() => loadList())
      .catch(() => {});
  };

  const location = useLocation();
  const isActive = (path: string) =>
    location.pathname.includes(path) ||
    (path === "/inbox" && location.pathname === "/");
  const navBtn = (path: string) =>
    `inline-flex items-center px-4 py-2 rounded-[10px] text-[13px] font-medium text-white transition-all duration-200 ${isActive(path) ? "bg-[#F97316]" : "bg-[#60A5FA] hover:bg-[#F97316]"}`;

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-sm">
        <div className="max-w-[1200px] mx-auto flex items-center gap-4 px-6 h-14">
          <div className="flex items-center gap-2 p-1.5 rounded-[12px] bg-[#F3F4F6]/60 border border-[#E5E7EB]/80">
            <Link to="/inbox" className={navBtn("/inbox")}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="mr-1.5 shrink-0"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              Inbox
            </Link>
            <Link
              to="/settings/empreendimentos"
              className={navBtn("/settings/empreendimentos")}
            >
              Empreendimentos
            </Link>
            <Link
              to="/settings/corretores"
              className={navBtn("/settings/corretores")}
            >
              Corretores
            </Link>
            <Link to="/agenda" className={navBtn("/agenda")}>
              Agenda
            </Link>
            <Link
              to="/settings/integrations/whatsapp"
              className={navBtn("/settings/integrations/whatsapp")}
            >
              Configurações
            </Link>
          </div>
          <h1 className="text-[15px] font-semibold text-[#111827]">
            Corretores
          </h1>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <p className="text-[13px] text-[#6B7280]">
            Cadastro de corretores para uso na fila de atendimentos.
          </p>
          <button type="button" onClick={openNew} className={btnPrimary}>
            Novo corretor
          </button>
        </div>

        <div className={card}>
          {loading ? (
            <div className="flex items-center gap-2 py-8 justify-center">
              <div className="h-5 w-5 rounded-full border-2 border-[#3B82F6] border-t-transparent animate-spin" />
              <span className="text-[13px] text-[#6B7280]">Carregando…</span>
            </div>
          ) : list.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-[15px] font-medium text-[#111827] mb-1">
                Nenhum corretor cadastrado
              </p>
              <p className="text-[13px] text-[#6B7280] mb-4">
                Clique em &quot;Novo corretor&quot; para começar.
              </p>
              <button type="button" onClick={openNew} className={btnPrimary}>
                Novo corretor
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E5E7EB]">
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">
                      Nome
                    </th>
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">
                      Cidade
                    </th>
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">
                      Telefone
                    </th>
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">
                      Imobiliária
                    </th>
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">
                      Status
                    </th>
                    <th className="py-3 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]"
                    >
                      <td className="py-3.5 px-4 text-[14px] font-medium text-[#111827]">
                        {c.fullName}
                      </td>
                      <td className="py-3.5 px-4 text-[13px] text-[#6B7280]">
                        {c.city || "—"}
                      </td>
                      <td className="py-3.5 px-4 text-[13px] text-[#6B7280]">
                        {c.phone || "—"}
                      </td>
                      <td className="py-3.5 px-4 text-[13px] text-[#6B7280]">
                        {c.realEstateAgency || "—"}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex text-[11px] font-semibold px-2.5 py-1 rounded-md ${c.active ? "bg-[#D1FAE5] text-[#059669]" : "bg-[#F3F4F6] text-[#6B7280]"}`}
                        >
                          {c.active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className={btnGhost + " text-[12px] mr-2"}
                        >
                          Editar
                        </button>
                        {c.active && (
                          <button
                            type="button"
                            onClick={() => handleInactivate(c.id)}
                            className="text-[12px] font-medium text-[#9CA3AF] hover:text-red-600 transition-colors"
                          >
                            Inativar
                          </button>
                        )}
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={closeModal}
        >
          <div
            className={`${card} w-full max-w-md shadow-xl max-h-[90vh] flex flex-col overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="overflow-y-auto flex-1 min-h-0 pb-20">
              <h2 className="text-[16px] font-semibold text-[#111827] mb-5">
                {editingId != null ? "Editar corretor" : "Novo corretor"}
              </h2>
              {err && (
                <div className="mb-4 text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-4 py-3">
                  {err}
                </div>
              )}
              <div className="space-y-4">
                <label>
                  <span className={label}>Nome completo</span>
                  <input
                    className={field}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ex.: João Silva"
                  />
                </label>
                <label>
                  <span className={label}>Cidade</span>
                  <input
                    className={field}
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Ex.: São Paulo"
                  />
                </label>
                <label>
                  <span className={label}>Telefone</span>
                  <input
                    className={field}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Ex.: (11) 99999-9999"
                  />
                </label>
                <label>
                  <span className={label}>Imobiliária</span>
                  <input
                    className={field}
                    value={realEstateAgency}
                    onChange={(e) => setRealEstateAgency(e.target.value)}
                    placeholder="Ex.: Imobiliária XYZ"
                  />
                </label>
                <div>
                  <span className={label}>Empreendimentos atendidos</span>
                  <p className="text-[12px] text-[#9CA3AF] mb-2">
                    Selecione os empreendimentos que este corretor pode atender.
                  </p>
                  <div className="max-h-32 overflow-y-auto rounded-[8px] border border-[#E5E7EB] p-2 space-y-1.5">
                    {projects.length === 0 ? (
                      <p className="text-[12px] text-[#9CA3AF] py-2">
                        Nenhum empreendimento cadastrado.
                      </p>
                    ) : (
                      projects.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-center gap-2 cursor-pointer hover:bg-[#F9FAFB] rounded px-2 py-1"
                        >
                          <input
                            type="checkbox"
                            checked={selectedEnterpriseIds.includes(p.id)}
                            onChange={() => toggleEnterprise(p.id)}
                            className="rounded border-[#E5E7EB]"
                          />
                          <span className="text-[13px] text-[#111827]">
                            {p.name}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <span className={label}>Disponibilidade semanal</span>
                  <p className="text-[12px] text-[#9CA3AF] mb-2">
                    Horários em que o corretor está disponível para
                    agendamentos.
                  </p>
                  <button
                    type="button"
                    onClick={applyHorarioComercial}
                    className="mb-3 text-[12px] font-medium text-[#3B82F6] hover:text-[#1D4ED8]"
                  >
                    Horário comercial (Seg–Sex 09:00–18:00)
                  </button>
                  {editingId != null ? (
                    <>
                      <div className="space-y-2">
                        {availability.map((s) => (
                          <div
                            key={s.id}
                            className="flex items-center gap-2 flex-wrap"
                          >
                            {editingSlotId === s.id ? (
                              <>
                                <select
                                  className={field + " flex-1 min-w-0"}
                                  value={editSlotWeekday}
                                  onChange={(e) =>
                                    setEditSlotWeekday(Number(e.target.value))
                                  }
                                >
                                  {WEEKDAYS.map((d, i) => (
                                    <option key={i} value={i}>
                                      {d}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="time"
                                  className={field + " w-24"}
                                  value={editSlotStart}
                                  onChange={(e) =>
                                    setEditSlotStart(e.target.value)
                                  }
                                />
                                <span>-</span>
                                <input
                                  type="time"
                                  className={field + " w-24"}
                                  value={editSlotEnd}
                                  onChange={(e) =>
                                    setEditSlotEnd(e.target.value)
                                  }
                                />
                                <label className="flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={editSlotActive}
                                    onChange={(e) =>
                                      setEditSlotActive(e.target.checked)
                                    }
                                  />
                                  <span className="text-[12px]">Ativo</span>
                                </label>
                                <button
                                  type="button"
                                  onClick={saveEditSlot}
                                  className={btnGhost + " text-[12px]"}
                                >
                                  Salvar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingSlotId(null)}
                                  className="text-[12px] text-[#9CA3AF]"
                                >
                                  Cancelar
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="text-[13px] flex-1">
                                  {WEEKDAYS[s.weekday]}{" "}
                                  {s.startTime.slice(0, 5)}–
                                  {s.endTime.slice(0, 5)}{" "}
                                  {!s.active && "(inativo)"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => startEditSlot(s)}
                                  className={btnGhost + " text-[12px]"}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeSlot(s.id)}
                                  className="text-[12px] text-[#9CA3AF] hover:text-red-600"
                                >
                                  Remover
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-[#E5E7EB]">
                          <select
                            className={field + " w-24"}
                            value={newSlotWeekday}
                            onChange={(e) =>
                              setNewSlotWeekday(Number(e.target.value))
                            }
                          >
                            {WEEKDAYS.map((d, i) => (
                              <option key={i} value={i}>
                                {d}
                              </option>
                            ))}
                          </select>
                          <input
                            type="time"
                            className={field + " w-24"}
                            value={newSlotStart}
                            onChange={(e) => setNewSlotStart(e.target.value)}
                          />
                          <input
                            type="time"
                            className={field + " w-24"}
                            value={newSlotEnd}
                            onChange={(e) => setNewSlotEnd(e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={addSlot}
                            className={btnGhost + " text-[12px]"}
                          >
                            Adicionar horário
                          </button>
                        </div>
                      </div>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={(e) => setActive(e.target.checked)}
                          className="rounded border-[#E5E7EB]"
                        />
                        <span className={label + " mb-0"}>Ativo</span>
                      </label>
                    </>
                  ) : (
                    <div className="space-y-2">
                      {draftSlots.map((s, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 flex-wrap"
                        >
                          <span className="text-[13px] flex-1">
                            {WEEKDAYS[s.weekday]} {s.startTime}–{s.endTime}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeDraftSlot(idx)}
                            className="text-[12px] text-[#9CA3AF] hover:text-red-600"
                          >
                            Remover
                          </button>
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-[#E5E7EB]">
                        <select
                          className={field + " w-24"}
                          value={newSlotWeekday}
                          onChange={(e) =>
                            setNewSlotWeekday(Number(e.target.value))
                          }
                        >
                          {WEEKDAYS.map((d, i) => (
                            <option key={i} value={i}>
                              {d}
                            </option>
                          ))}
                        </select>
                        <input
                          type="time"
                          className={field + " w-24"}
                          value={newSlotStart}
                          onChange={(e) => setNewSlotStart(e.target.value)}
                        />
                        <input
                          type="time"
                          className={field + " w-24"}
                          value={newSlotEnd}
                          onChange={(e) => setNewSlotEnd(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={addDraftSlot}
                          className={btnGhost + " text-[12px]"}
                        >
                          Adicionar horário
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="shrink-0 border-t border-[#E5E7EB] bg-white flex gap-3 pt-4 px-6 pb-6 -mx-6 -mb-6">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className={btnPrimary}
              >
                {saving
                  ? "Salvando…"
                  : editingId != null
                    ? "Salvar"
                    : "Cadastrar"}
              </button>
              <button type="button" onClick={closeModal} className={btnGhost}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
