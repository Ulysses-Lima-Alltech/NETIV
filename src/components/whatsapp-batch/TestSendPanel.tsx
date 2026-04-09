interface Props {
  testPhone: string;
  loading: boolean;
  result: string | null;
  onTestPhoneChange: (value: string) => void;
  onSendTest: () => Promise<void>;
}

const inputCls =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px] bg-white focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

export function TestSendPanel({ testPhone, loading, result, onTestPhoneChange, onSendTest }: Props) {
  return (
    <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3">
      <h2 className="text-[14px] font-semibold">Envio de teste</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <input
          className={inputCls}
          value={testPhone}
          placeholder="Número para teste (com DDD)"
          onChange={(e) => onTestPhoneChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => void onSendTest()}
          disabled={!testPhone || loading}
          className="px-4 py-2 rounded-[10px] bg-[#7C3AED] text-white text-[13px] font-semibold hover:bg-[#6D28D9] disabled:opacity-60"
        >
          {loading ? 'Enviando teste...' : 'Enviar teste'}
        </button>
      </div>
      {result && <p className="text-[12px] text-[#374151]">{result}</p>}
    </section>
  );
}
