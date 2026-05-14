import { useState } from 'react';
import { whatsappApi, ApiError } from '../api/client';

interface NewMessageModalProps {
  open: boolean;
  onClose: () => void;
  onSent: (conversationId?: number) => void;
}

const field =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3.5 py-[10px] text-[14px] text-[#111827] placeholder:text-[#9CA3AF] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

export function NewMessageModal({ open, onClose, onSent }: NewMessageModalProps) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [windowClosed, setWindowClosed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const digits = phone.replace(/\D/g, '');

    if (digits.length < 10) {
      setError('Informe um número válido (com DDD).');
      return;
    }

    const text = message.trim() || 'Olá!';

    setError(null);
    setWindowClosed(false);
    setSending(true);

    whatsappApi
      .send(digits, text)
      .then((data) => {
        const convId = (data as { conversationId?: number }).conversationId;

        setPhone('');
        setMessage('');
        onSent(convId);
        onClose();
      })
      .catch((err: Error) => {
        if (err instanceof ApiError && err.code === 'WHATSAPP_WINDOW_CLOSED') {
          setWindowClosed(true);
          setError(
            'Este contato não interagiu nas últimas 24 horas. Para iniciar contato, cadastre um template aprovado na Meta antes de enviar.'
          );
          return;
        }

        setError(err.message ?? 'Erro ao enviar.');
      })
      .finally(() => setSending(false));
  };

  const handleClose = () => {
    if (!sending) {
      setError(null);
      setWindowClosed(false);
      setPhone('');
      setMessage('');
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]"
      aria-modal="true"
      role="dialog"
    >
      <div className="bg-white rounded-[16px] shadow-[0_20px_60px_rgba(0,0,0,0.12)] max-w-md w-full p-6 border border-[#E5E7EB]">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[16px] font-semibold text-[#111827]">Nova mensagem</h2>

          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-[8px] text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#6B7280] transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="block text-[13px] font-medium text-[#6B7280] mb-1.5">
              Número (com DDD)
            </span>

            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ex: 5511999999999"
              className={field}
              autoFocus
            />
          </label>

          <label className="block">
            <span className="block text-[13px] font-medium text-[#6B7280] mb-1.5">
              Primeira mensagem (opcional)
            </span>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Olá!"
              rows={3}
              className={`${field} resize-none`}
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 text-[13px] text-red-700 bg-red-50 border border-red-100 rounded-[10px] px-3.5 py-2.5">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 mt-px"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>

              {error}
            </div>
          )}

          {windowClosed && (
            <div className="space-y-2 rounded-[10px] border border-[#E5E7EB] p-3 bg-[#F9FAFB]">
              <p className="text-[12px] text-[#374151]">
                Não há templates cadastrados no catálogo local no momento.
              </p>

              <p className="text-[12px] text-[#6B7280]">
                Cadastre um template aprovado na Meta para permitir início de conversa fora da janela de 24 horas.
              </p>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={sending}
              className="px-4 py-[9px] text-[13px] font-medium text-[#6B7280] bg-[#F3F4F6] rounded-[10px] hover:bg-[#E5E7EB] disabled:opacity-40 transition-colors"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={sending}
              className="px-5 py-[9px] text-[13px] font-semibold text-white bg-[#F97316] rounded-[10px] hover:bg-[#EA580C] active:bg-[#C2410C] disabled:opacity-40 transition-colors shadow-sm"
            >
              {sending ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  Enviando...
                </span>
              ) : (
                'Iniciar conversa'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
