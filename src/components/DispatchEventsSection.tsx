import { useEffect, useRef, useState } from 'react';
import { dispatchEventsApi, fetchAuthenticatedBlob, type DispatchEvent } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { DispatchEventModal } from './DispatchEventModal';

function EventArt({ id, name }: { id: string; name: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    void fetchAuthenticatedBlob(`/dispatch-events/${id}/art`).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {
      if (!cancelled) setUrl('');
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return url
    ? <img src={url} alt={`Arte de ${name}`} className="h-28 w-full rounded-lg object-cover" />
    : <div className="flex h-28 items-center justify-center rounded-lg bg-[#F1F5F9] text-sm">Arte indisponível</div>;
}

const statusLabels: Record<string, string> = {
  PENDING: 'Agendado / na fila',
  PROCESSING: 'Processando',
  SENT: 'Envios aceitos pela Meta',
  PARTIAL_FAILED: 'Concluído com falhas',
  FAILED: 'Falhou',
  CANCELED: 'Cancelado',
};

function AdminDispatchEvents({ showEvents }: { showEvents: boolean }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<DispatchEvent[]>([]);
  const [visibleCount, setVisibleCount] = useState(12);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestVersion = useRef(0);

  useEffect(() => {
    if (!showEvents) return;
    let cancelled = false;
    async function refresh() {
      const version = ++requestVersion.current;
      try {
        const result = await dispatchEventsApi.list();
        if (!cancelled && version === requestVersion.current) {
          setEvents(result.events);
          setError('');
        }
      } catch {
        if (!cancelled && version === requestVersion.current) setError('Não foi possível atualizar os disparos.');
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [showEvents]);

  function saved(event: DispatchEvent) {
    requestVersion.current++;
    setEvents((previous) => [event, ...previous.filter((item) => item.id !== event.id)]);
    setNotice(event.sendMode === 'NOW'
      ? 'Salvo. Disparo na fila para iniciar agora.'
      : 'Salvo e agendado com sucesso.');
  }

  return (
    <section className="space-y-4 rounded-[16px] border-2 border-[#3B82F6] bg-[#EFF6FF] p-5 shadow-[0_4px_16px_rgba(37,99,235,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {showEvents && (
          <div>
            <h2 className="text-xl font-extrabold text-[#123A73]">Disparo Programado por Evento</h2>
            <p className="mt-1 text-sm text-[#475569]">
              Cadastre um disparo e acompanhe os leads e o andamento por aqui.
            </p>
          </div>
        )}
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-[10px] border-2 border-emerald-700 bg-emerald-700 px-5 py-2 text-sm font-extrabold text-white shadow-sm transition-colors hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            className="h-[18px] w-[18px]"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M16 3v4M8 3v4M3 10h18M12 13v6M9 16h6" />
          </svg>
          Agendar Disparo
        </button>
      </div>
      {notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {showEvents && (
        <p className="text-xs text-[#6B7280]">
          <span className="italic">
            Exibindo {Math.min(events.length, visibleCount)} das {events.length} campanhas carregadas (limite: 200).
          </span>
        </p>
      )}
      {showEvents && events.length === 0 && !error && <p className="text-sm">Nenhum disparo cadastrado.</p>}
      {showEvents && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.slice(0, visibleCount).map((event) => (
            <article key={event.id} className="space-y-2 rounded-lg border border-[#BFDBFE] bg-white p-3">
              <EventArt id={event.id} name={event.name} />
              <h3 className="font-semibold">{event.name}</h3>
              <p className="text-sm">{event.enterpriseName ?? 'Empreendimento indisponível'}</p>
              <p className="text-sm">{new Date(event.scheduledAt).toLocaleString('pt-BR')}</p>
              <p className="text-sm">{statusLabels[event.status] ?? event.status}</p>
              <p className="text-xs">
                Leads: {event.total} / Aceitos: {event.accepted} / Falhas ou bloqueios: {event.failed}
              </p>
              <p className="text-xs">
                Atendimento: {event.postSendMode === 'HANDOFF' ? 'Humano' : 'ANA'}
              </p>
              {event.error && <p className="text-xs text-red-700">{event.error}</p>}
            </article>
          ))}
        </div>
      )}
      {showEvents && events.length > visibleCount && (
        <button type="button" onClick={() => setVisibleCount((count) => count + 12)}
          className="rounded-lg border px-3 py-2 text-sm">
          Mostrar mais
        </button>
      )}
      {open && <DispatchEventModal onClose={() => setOpen(false)} onSaved={saved} />}
    </section>
  );
}

export function DispatchEventsSection({ showEvents = true }: { showEvents?: boolean }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <AdminDispatchEvents showEvents={showEvents} /> : null;
}
