import { useState, useRef, useCallback } from 'react';

interface ChatComposerProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatComposer({ onSend, disabled = false, placeholder = 'Digite sua mensagem...' }: ChatComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, onSend]);

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

  return (
    <div className="flex gap-3 items-end p-4 border-t border-[#E5E7EB] bg-white">
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
        disabled={disabled || !text.trim()}
        aria-label="Enviar mensagem"
        className="shrink-0 inline-flex items-center gap-1.5 px-5 py-[10px] text-[14px] font-semibold text-white bg-[#F97316] rounded-[10px] hover:bg-[#EA580C] active:bg-[#C2410C] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Enviar
      </button>
    </div>
  );
}
