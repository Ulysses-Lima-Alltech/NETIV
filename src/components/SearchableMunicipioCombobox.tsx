import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadMunicipiosIbge } from '../data/municipiosIbgeCache';
import type { MunicipioIbge } from '../types/municipioIbge';
import { formatMunicipioLabel } from '../types/municipioIbge';

const field =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3.5 py-[10px] text-[14px] leading-5 text-[#111827] placeholder:text-[#9CA3AF] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

const MAX_RESULTS = 60;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export function SearchableMunicipioCombobox(props: {
  valueIbge: number | null;
  onSelect: (m: MunicipioIbge) => void;
  onClear?: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { valueIbge, onSelect, onClear, disabled, placeholder = 'Buscar cidade…' } = props;
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [all, setAll] = useState<MunicipioIbge[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loadState !== 'idle') return;
    setLoadState('loading');
    loadMunicipiosIbge()
      .then((rows) => {
        setAll(rows);
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
  }, [loadState]);

  const selected = useMemo(() => {
    if (valueIbge == null || !Number.isFinite(valueIbge)) return null;
    return all.find((m) => m.i === valueIbge) ?? null;
  }, [all, valueIbge]);

  const filtered = useMemo(() => {
    if (all.length === 0) return [];
    const nq = norm(q.trim());
    if (nq.length < 2) return [];
    const out: MunicipioIbge[] = [];
    for (const m of all) {
      const hay = `${norm(m.n)} ${norm(m.u)} ${norm(m.ri ?? '')} ${norm(m.rint ?? '')}`;
      if (hay.includes(nq)) {
        out.push(m);
        if (out.length >= MAX_RESULTS) break;
      }
    }
    return out;
  }, [all, q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const showList = open && q.trim().length >= 2 && filtered.length > 0;

  const pick = useCallback(
    (m: MunicipioIbge) => {
      onSelect(m);
      setQ('');
      setOpen(false);
    },
    [onSelect]
  );

  return (
    <div ref={wrapRef} className="relative">
      {selected ? (
        <div className="flex flex-wrap gap-2 items-center">
          <div
            className={`${field} flex-1 min-w-0 bg-[#F9FAFB] text-[#111827]`}
            title={formatMunicipioLabel(selected)}
          >
            {formatMunicipioLabel(selected)}
          </div>
          <button
            type="button"
            disabled={disabled}
            className="text-[12px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] shrink-0 py-2"
            onClick={() => {
              onClear?.();
              setQ('');
              setOpen(false);
            }}
          >
            Alterar
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            className={field}
            disabled={disabled || loadState === 'loading'}
            placeholder={
              loadState === 'loading'
                ? 'Carregando municípios…'
                : loadState === 'error'
                  ? 'Erro ao carregar lista IBGE'
                  : placeholder
            }
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            autoComplete="off"
          />
          {showList && (
            <ul className="absolute z-20 mt-1 max-h-[280px] w-full overflow-y-auto rounded-[10px] border border-[#E5E7EB] bg-white py-1 shadow-lg">
              {filtered.map((m) => (
                <li key={m.i}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-[13px] text-[#111827] hover:bg-[#F3F4F6]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(m)}
                  >
                    {formatMunicipioLabel(m)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
