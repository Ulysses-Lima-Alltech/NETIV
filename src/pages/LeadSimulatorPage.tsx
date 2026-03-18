import { useState } from 'react';
import { Link } from 'react-router-dom';
import { leadApi } from '../api/client';
import type { LeadAnalysisResponse } from '../api/client';

const field =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3.5 py-[10px] text-[14px] text-[#111827] placeholder:text-[#9CA3AF] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

export function LeadSimulatorPage() {
  const [messagesText, setMessagesText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LeadAnalysisResponse | null>(null);

  const handleAnalyze = () => {
    const messages = messagesText.split(/\n/).map((s) => s.trim()).filter(Boolean);
    setError(null);
    setResult(null);
    setLoading(true);
    leadApi
      .analyze(messages)
      .then((data) => setResult(data))
      .catch((err: Error) => setError(err.message ?? 'Erro ao analisar.'))
      .finally(() => setLoading(false));
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
          <h1 className="text-[15px] font-semibold text-[#111827]">Simulador de Leads</h1>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-6 py-10">
        <div className="bg-white rounded-[12px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-6">
          <h2 className="text-[16px] font-semibold text-[#111827] mb-2">Análise de conversa</h2>
          <p className="text-[13px] text-[#9CA3AF] mb-5">Cole ou digite as mensagens da conversa (uma por linha). O sistema classifica sem usar OpenAI.</p>
          <textarea value={messagesText} onChange={(e) => setMessagesText(e.target.value)} placeholder={'Ex.:\nOi, quero saber mais sobre o serviço\nQuanto custa?\nQuero contratar, manda proposta'} rows={8} className={`${field} resize-y mb-5`} />
          <button type="button" onClick={handleAnalyze} disabled={loading} className="inline-flex items-center justify-center gap-2 text-[14px] font-semibold bg-[#F97316] text-white rounded-[10px] px-6 py-[10px] hover:bg-[#EA580C] active:bg-[#C2410C] disabled:opacity-40 transition-colors shadow-sm">
            {loading ? (
              <><span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />Analisando…</>
            ) : (
              <><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>Analisar Lead</>
            )}
          </button>
        </div>

        {error && (
          <div className="mt-5 flex items-start gap-3 text-[13px] text-red-700 bg-red-50 border border-red-100 rounded-[12px] px-5 py-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {error}
          </div>
        )}

        {result && (
          <div className="mt-5 bg-white rounded-[12px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-6">
            <h2 className="text-[16px] font-semibold text-[#111827] mb-4">Resultado</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-[14px]">
              <dt className="text-[#6B7280] font-medium">Lead Score</dt>
              <dd className="text-[#111827] font-semibold">{result.leadScore}</dd>
              <dt className="text-[#6B7280] font-medium">Lead Stage</dt>
              <dd><span className="inline-flex items-center text-[12px] font-semibold px-2.5 py-1 rounded-[6px] bg-[#EFF6FF] text-[#3B82F6]">{result.leadStage}</span></dd>
              <dt className="text-[#6B7280] font-medium">Intent Now</dt>
              <dd className="text-[#111827] font-medium">{result.leadIntentNow}</dd>
              <dt className="text-[#6B7280] font-medium">Motivo</dt>
              <dd className="text-[#374151]">{result.reason}</dd>
            </dl>
          </div>
        )}
      </main>
    </div>
  );
}
