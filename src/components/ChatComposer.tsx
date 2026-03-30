import { useState, useRef, useCallback } from 'react';

const ACCEPT_MANUAL = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';

interface ChatComposerProps {
  onSend: (text: string, file?: File | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatComposer({ onSend, disabled = false, placeholder = 'Digite sua mensagem...' }: ChatComposerProps) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (disabled || (!trimmed && !file)) return;
    onSend(trimmed, file);
    setText('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
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
    const lineHeight = 24;
    const maxHeight = lineHeight * 4;
    target.style.height = `${Math.min(target.scrollHeight, maxHeight)}px`;
  };

  const canSend = !disabled && (text.trim().length > 0 || file != null);

  return (
    <div className="flex flex-col gap-2 p-4 border-t border-[#E5E7EB] bg-white">
      {file && (
        <div className="flex items-center justify-between gap-2 rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[12px] text-[#374151]">
          <span className="truncate">
            📎 <span className="font-medium">{file.name}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
            className="shrink-0 text-[#6B7280] hover:text-[#111827] underline"
          >
            remover
          </button>
        </div>
      )}
      <div className="flex gap-3 items-end">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_MANUAL}
          className="hidden"
          aria-hidden
          disabled={disabled}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          title="Anexar arquivo (PDF, JPG, PNG, WEBP)"
          aria-label="Anexar arquivo"
          className="shrink-0 inline-flex h-[42px] w-[42px] items-center justify-center rounded-[10px] border border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
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
          className="flex-1 min-h-[42px] max-h-[96px] resize-none px-3.5 py-[10px] text-[14px] border border-[#E5E7EB] rounded-[10px] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none disabled:bg-[#F9FAFB] disabled:text-[#9CA3AF] placeholder:text-[#9CA3AF]"
        />
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label="Enviar mensagem"
          className="shrink-0 inline-flex items-center gap-1.5 px-5 py-[10px] text-[14px] font-semibold text-white bg-[#F97316] rounded-[10px] hover:bg-[#EA580C] active:bg-[#C2410C] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Enviar
        </button>
      </div>
    </div>
  );
}
