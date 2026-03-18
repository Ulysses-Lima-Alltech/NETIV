import { useState } from 'react';
import { Link } from 'react-router-dom';
import { whatsappApi } from '../api/client';

const field =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3.5 py-[10px] text-[14px] text-[#111827] placeholder:text-[#9CA3AF] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

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
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-sm">
        <div className="max-w-[1200px] mx-auto flex items-center gap-4 px-6 h-14">
          <Link to="/inbox" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            Inbox
          </Link>
          <div className="h-4 w-px bg-[#E5E7EB]" />
          <h1 className="text-[15px] font-semibold text-[#111827]">Enviar WhatsApp</h1>
          <Link to="/settings/integrations/whatsapp" className="ml-auto text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors">
            Configurações
          </Link>
        </div>
      </header>
      <main className="max-w-xl mx-auto px-6 py-10">
        <div className="bg-white rounded-[12px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-6">
          <h2 className="text-[16px] font-semibold text-[#111827] mb-5">Enviar mensagem</h2>
          <form onSubmit={handleSend} className="space-y-5">
            <label className="block">
              <span className="block text-[13px] font-medium text-[#6B7280] mb-1.5">Número do destinatário</span>
              <input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="5511999999999 (com DDI, sem + ou espaços)" className={field} />
            </label>
            <label className="block">
              <span className="block text-[13px] font-medium text-[#6B7280] mb-1.5">Mensagem</span>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Digite a mensagem..." rows={4} className={`${field} resize-none`} />
            </label>
            {result && (
              <div className={`flex items-start gap-2 text-[13px] rounded-[10px] px-4 py-3 ${result.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                {result.success ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                )}
                {result.text}
              </div>
            )}
            <button type="submit" disabled={sending} className="w-full inline-flex items-center justify-center gap-2 text-[14px] font-semibold bg-[#F97316] text-white rounded-[10px] px-6 py-[10px] hover:bg-[#EA580C] active:bg-[#C2410C] disabled:opacity-40 transition-colors shadow-sm">
              {sending ? (
                <><span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />Enviando…</>
              ) : (
                <><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Enviar</>
              )}
            </button>
          </form>
          <p className="mt-5 text-[12px] text-[#9CA3AF]">Configure o token e o Phone Number ID em Configurações antes de enviar.</p>
        </div>
      </main>
    </div>
  );
}
