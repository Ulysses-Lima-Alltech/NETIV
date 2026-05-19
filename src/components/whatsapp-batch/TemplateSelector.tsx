import type { BatchTemplateCatalogItem } from '../../types/whatsappBatch';

interface Props {
  templates: BatchTemplateCatalogItem[];
  selectedKey: string;
  onSelect: (key: string) => void;
  loading?: boolean;
  selectDisabled?: boolean;
}

const inputCls =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px] bg-white focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

export function TemplateSelector({ templates, selectedKey, onSelect, loading, selectDisabled }: Props) {
  return (
    <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3">
      <h2 className="text-[14px] font-semibold">Templates</h2>
      {loading ? <p className="text-[13px] text-[#6B7280]">Carregando templates...</p> : null}
      <select
        className={inputCls}
        value={selectedKey}
        onChange={(e) => onSelect(e.target.value)}
        disabled={loading || selectDisabled}
        aria-busy={loading}
      >
        <option value="">Selecione um template</option>
        {templates.map((tpl) => (
          <option key={tpl.key} value={tpl.key}>
            {tpl.name}
          </option>
        ))}
      </select>
    </section>
  );
}
