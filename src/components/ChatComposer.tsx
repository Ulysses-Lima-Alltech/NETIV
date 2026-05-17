import { useState, useRef, useCallback } from 'react';
import { validateManualUploadFile } from '../constants/whatsappManualUpload';

const ACCEPT_MANUAL =
  '.pdf,.jpg,.jpeg,.png,.webp,.mp4,.3gp,application/pdf,image/jpeg,image/png,image/webp,video/mp4,video/3gpp';

interface ChatComposerProps {
  onSend: (text: string, file?: File | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatComposer({ onSend, disabled = false, placeholder = 'Digite sua mensagem...' }: ChatComposerProps) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (disabled || (!trimmed && !file)) return;
    if (file) {
      const v = validateManualUploadFile(file);
      if (!v.ok) {
        setFileError(v.message);
        return;
      }
    }

    setFileError(null);
    onSend(trimmed, file);
    setText('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [text, file, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    setText(target.value);
    target.style.height = 'auto';
    const lineHeight = 22;
    const maxHeight = lineHeight * 4;
    target.style.height = `${Math.min(target.scrollHeight, maxHeight)}px`;
  };

  const canSend = !disabled && (text.trim().length > 0 || file != null);

  return (
    <div className="border-t border-[#e2e8f0] bg-[rgba(255,255,255,0.95)] p-3">
      {fileError && (
        <div className="mb-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">{fileError}</div>
      )}

      {file && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-[12px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[12px] text-[#334155]">
          <span className="inline-flex min-w-0 items-center gap-2 truncate">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span className="truncate font-medium">{file.name}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setFileError(null);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
            className="shrink-0 text-[11px] font-medium text-[#64748b] hover:text-[#0f172a]"
          >
            remover
          </button>
        </div>
      )}

      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_MANUAL}
          className="hidden"
          aria-hidden
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFileError(null);
            if (!f) {
              setFile(null);
              return;
            }
            const v = validateManualUploadFile(f);
            if (!v.ok) {
              setFileError(v.message);
              setFile(null);
              if (fileInputRef.current) fileInputRef.current.value = '';
              return;
            }
            setFile(f);
          }}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          title="Anexar arquivo"
          aria-label="Anexar arquivo"
          className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-[14px] border border-[#e2e8f0] bg-white text-[#475569] transition-colors hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          aria-label="Mensagem"
          className="min-h-[44px] max-h-[96px] w-full resize-none rounded-[15px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-[11px] text-[14px] text-[#0f172a] placeholder:text-[#94a3b8] transition focus:border-[#3b82f6] focus:ring-[4px] focus:ring-[rgba(59,130,246,0.12)] focus:outline-none disabled:cursor-not-allowed disabled:text-[#94a3b8]"
        />

        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label="Enviar mensagem"
          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-[13px] bg-[#f97316] px-4 text-[13px] font-semibold text-white shadow-[0_12px_26px_rgba(249,115,22,0.22)] transition-colors hover:bg-[#ea580c] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4z"/></svg>
          Enviar
        </button>
      </div>
    </div>
  );
}
