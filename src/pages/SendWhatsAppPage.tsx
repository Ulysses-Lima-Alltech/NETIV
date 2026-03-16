import { useState } from 'react';
import { Link } from 'react-router-dom';
import { whatsappApi } from '../api/client';

export function SendWhatsAppPage() {
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; text: string } | null>(null);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTo = to.trim().replace(/\D/g, '');
    const trimmedMsg = message.trim();
    if (!trimmedTo || !trimmedMsg) {
      setResult({ success: false, text: 'Preencha o número e a mensagem.' });
      return;
    }
    setSending(true);
    setResult(null);
    whatsappApi
      .send(trimmedTo, trimmedMsg)
      .then((data) => {
        setResult({
          success: data.success,
          text: data.success ? `Mensagem enviada. ID: ${data.metaMessageId ?? '-'}` : 'Falha no envio.',
        });
        if (data.success) setMessage('');
      })
      .catch((err: Error) => {
        setResult({ success: false, text: err.message ?? 'Erro ao enviar.' });
      })
      .finally(() => setSending(false));
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col">
      <header className="border-b border-gray-200 px-4 py-3 flex items-center gap-4 shrink-0">
        <Link to="/inbox" className="text-sm text-gray-600 hover:text-gray-900">
          ← Voltar
        </Link>
        <h1 className="text-lg font-semibold">Enviar mensagem WhatsApp</h1>
        <Link
          to="/settings/integrations/whatsapp"
          className="ml-auto text-sm text-blue-600 hover:text-blue-800"
        >
          Configurações
        </Link>
      </header>

      <main className="flex-1 max-w-xl mx-auto w-full px-4 py-8">
        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Número do destinatário</label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="5511999999999 (com DDI, sem + ou espaços)"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mensagem</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Digite a mensagem..."
              rows={4}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>
          {result && (
            <div
              className={`p-3 rounded-lg text-sm ${
                result.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              }`}
            >
              {result.text}
            </div>
          )}
          <button
            type="submit"
            disabled={sending}
            className="w-full px-4 py-2.5 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            {sending ? 'Enviando...' : 'Enviar'}
          </button>
        </form>
        <p className="mt-4 text-xs text-gray-500">
          Configure o token e o Phone Number ID em Configurações antes de enviar.
        </p>
      </main>
    </div>
  );
}
