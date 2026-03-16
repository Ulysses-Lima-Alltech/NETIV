import { useState } from 'react';
import { Link } from 'react-router-dom';
import { leadApi } from '../api/client';
import type { LeadAnalysisResponse } from '../api/client';

export function LeadSimulatorPage() {
  const [messagesText, setMessagesText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LeadAnalysisResponse | null>(null);

  const handleAnalyze = () => {
    const messages = messagesText
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
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
    <div className="min-h-screen flex flex-col bg-white text-gray-900">
      <header className="shrink-0 flex items-center justify-between gap-4 px-4 py-2 border-b border-gray-200">
        <Link to="/inbox" className="text-sm text-gray-600 hover:text-gray-900">
          ← Voltar
        </Link>
        <h1 className="text-lg font-semibold">Simulador de Leads</h1>
      </header>

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full">
        <p className="text-sm text-gray-600 mb-4">
          Cole ou digite as mensagens da conversa (uma por linha). O sistema classifica sem usar OpenAI.
        </p>
        <textarea
          value={messagesText}
          onChange={(e) => setMessagesText(e.target.value)}
          placeholder={'Ex.:\nOi, quero saber mais sobre o serviço\nQuanto custa?\nQuero contratar, manda proposta'}
          rows={8}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-y mb-4"
        />
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Analisando...' : 'Analisar Lead'}
        </button>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-6 p-4 border border-gray-200 rounded-lg bg-gray-50 space-y-3">
            <h2 className="text-sm font-semibold text-gray-800">Resultado</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-gray-600">Lead Score:</dt>
              <dd className="font-medium">{result.leadScore}</dd>
              <dt className="text-gray-600">Lead Stage:</dt>
              <dd className="font-medium">{result.leadStage}</dd>
              <dt className="text-gray-600">Intent Now:</dt>
              <dd className="font-medium">{result.leadIntentNow}</dd>
              <dt className="text-gray-600">Motivo:</dt>
              <dd className="text-gray-700">{result.reason}</dd>
            </dl>
          </div>
        )}
      </main>
    </div>
  );
}
