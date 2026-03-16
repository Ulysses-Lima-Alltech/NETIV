import { useState } from 'react';
import { whatsappApi } from '../api/client';

interface NewMessageModalProps {
  open: boolean;
  onClose: () => void;
  onSent: (conversationId?: number) => void;
}

export function NewMessageModal({ open, onClose, onSent }: NewMessageModalProps) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
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
        setError(err.message ?? 'Erro ao enviar.');
      })
      .finally(() => setSending(false));
  };

  const handleClose = () => {
    if (!sending) {
      setError(null);
      setPhone('');
      setMessage('');
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" aria-modal="true" role="dialog">
      <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Nova mensagem</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-msg-phone" className="block text-sm font-medium text-gray-700 mb-1">
              Número (com DDD)
            </label>
            <input
              id="new-msg-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ex: 5511999999999"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="new-msg-body" className="block text-sm font-medium text-gray-700 mb-1">
              Primeira mensagem (opcional)
            </label>
            <textarea
              id="new-msg-body"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Olá!"
              rows={3}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={sending}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={sending}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50"
            >
              {sending ? 'Enviando...' : 'Iniciar conversa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
