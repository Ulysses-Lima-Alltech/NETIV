import type { Corretor, ProjectListItem } from '../../api/client';
import type { BatchTemplateCatalogItem, TemplateVariableSource } from '../../types/whatsappBatch';

interface Props {
  spreadsheet: {
    headers: string[];
    rowCount: number;
    sampleRows: Record<string, string>[];
  };
  suggestions: {
    phoneColumn: string;
    customerNameColumn?: string;
    enterpriseColumn?: string;
  };
  template: BatchTemplateCatalogItem | null;
  phoneColumn: string;
  onPhoneColumnChange: (value: string) => void;
  selectedEnterpriseId: string;
  onSelectedEnterpriseIdChange: (value: string) => void;
  selectedBrokerIds: string[];
  onSelectedBrokerIdsChange: (value: string[]) => void;
  projects: ProjectListItem[];
  brokers: Corretor[];
  variableMappings: Record<string, TemplateVariableSource>;
  onVariableMappingsChange: (mappings: Record<string, TemplateVariableSource>) => void;
  onPreview: () => Promise<void>;
  loadingPreview: boolean;
  previewDisabledReason?: string | null;
}

const inputCls =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px] bg-white focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

export function ColumnMappingPanel({
  spreadsheet,
  suggestions,
  template,
  phoneColumn,
  onPhoneColumnChange,
  selectedEnterpriseId,
  onSelectedEnterpriseIdChange,
  selectedBrokerIds,
  onSelectedBrokerIdsChange,
  projects,
  brokers,
  variableMappings,
  onVariableMappingsChange,
  onPreview,
  loadingPreview,
  previewDisabledReason,
}: Props) {
  if (!template) {
    return (
      <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4">
        <p className="text-[13px] text-[#6B7280]">Selecione um template para configurar o mapeamento.</p>
      </section>
    );
  }

  const updateVariableMapping = (variableId: string, mapping: TemplateVariableSource) => {
    onVariableMappingsChange({ ...variableMappings, [variableId]: mapping });
  };

  const activeBrokers = brokers.filter((b) => b.active);
  const toggleBroker = (brokerId: string) => {
    if (selectedBrokerIds.includes(brokerId)) {
      onSelectedBrokerIdsChange(selectedBrokerIds.filter((id) => id !== brokerId));
      return;
    }
    onSelectedBrokerIdsChange([...selectedBrokerIds, brokerId]);
  };

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-4">
      <h2 className="text-[14px] font-semibold">Mapeamento de dados</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[12px] text-[#374151] mb-1">Coluna de telefone</label>
          <select className={inputCls} value={phoneColumn} onChange={(e) => onPhoneColumnChange(e.target.value)}>
            <option value="">Selecione</option>
            {spreadsheet.headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          {suggestions?.phoneColumn && (
            <p className="text-[11px] text-[#6B7280] mt-1">Sugestão automática: {suggestions.phoneColumn}</p>
          )}
        </div>

        <div>
          <label className="block text-[12px] text-[#374151] mb-1">Empreendimento (cadastro interno)</label>
          <select className={inputCls} value={selectedEnterpriseId} onChange={(e) => onSelectedEnterpriseIdChange(e.target.value)}>
            <option value="">Nenhum</option>
            {projects.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-3">
          <label className="block text-[12px] text-[#374151] mb-1">Corretores participantes do lote</label>
          <p className="text-[11px] text-[#6B7280] mb-2">
            Selecione os corretores que participarão da distribuição automática deste lote.
          </p>
          <div className="border border-[#E5E7EB] rounded-[10px] max-h-[180px] overflow-y-auto p-2 space-y-1 bg-white">
            {activeBrokers.length === 0 ? (
              <p className="text-[12px] text-[#6B7280] px-1 py-1">Nenhum corretor ativo disponível.</p>
            ) : (
              activeBrokers.map((b) => {
                const brokerId = String(b.id);
                const checked = selectedBrokerIds.includes(brokerId);
                return (
                  <label key={b.id} className="flex items-center gap-2 px-1 py-1.5 rounded hover:bg-[#F8FAFC]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#0EA5E9]"
                      checked={checked}
                      onChange={() => toggleBroker(brokerId)}
                    />
                    <span className="text-[13px] text-[#111827]">{b.fullName}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {template.variables.map((v) => {
          const mapping = variableMappings[String(v.id)] ?? { type: 'column', columnName: '' };
          return (
            <div key={v.id} className="border border-[#E5E7EB] rounded-[10px] p-3">
              <p className="text-[12px] font-semibold text-[#111827] mb-2">
                {'{{'}
                {v.id}
                {'}}'} - {v.label} {v.required && <span className="text-red-500">*</span>}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] text-[#6B7280]">Tipo</label>
                  <select
                    className={inputCls}
                    value={mapping.type}
                    onChange={(e) =>
                      updateVariableMapping(String(v.id), {
                        type: e.target.value as 'column' | 'fixed' | 'enterprise',
                        columnName: e.target.value === 'column' ? mapping.columnName : undefined,
                        fixedValue: e.target.value === 'fixed' ? mapping.fixedValue : undefined,
                      })
                    }
                  >
                    <option value="column">Coluna da planilha</option>
                    <option value="fixed">Valor fixo</option>
                    <option value="enterprise">Nome do empreendimento</option>
                  </select>
                </div>

                {mapping.type === 'column' && (
                  <div>
                    <label className="text-[11px] text-[#6B7280]">Coluna</label>
                    <select
                      className={inputCls}
                      value={mapping.columnName || ''}
                      onChange={(e) =>
                        updateVariableMapping(String(v.id), {
                          ...mapping,
                          columnName: e.target.value,
                        })
                      }
                    >
                      <option value="">Selecione</option>
                      {spreadsheet.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {mapping.type === 'fixed' && (
                  <div>
                    <label className="text-[11px] text-[#6B7280]">Valor</label>
                    <input
                      type="text"
                      className={inputCls}
                      value={mapping.fixedValue || ''}
                      onChange={(e) =>
                        updateVariableMapping(String(v.id), {
                          ...mapping,
                          fixedValue: e.target.value,
                        })
                      }
                      placeholder="Digite o valor fixo"
                    />
                  </div>
                )}

                {mapping.type === 'enterprise' && (
                  <div>
                    <label className="text-[11px] text-[#6B7280]">Valor</label>
                    <input
                      type="text"
                      className={inputCls}
                      value={selectedEnterpriseId ? projects.find((p) => String(p.id) === selectedEnterpriseId)?.name || '' : ''}
                      disabled
                      placeholder="Nome do empreendimento selecionado"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => void onPreview()}
          disabled={!phoneColumn || loadingPreview || Boolean(previewDisabledReason)}
          className="px-4 py-2 rounded-[10px] bg-[#0EA5E9] text-white text-[13px] font-semibold hover:bg-[#0284C7] disabled:opacity-60"
        >
          {loadingPreview ? 'Gerando preview...' : 'Gerar preview'}
        </button>
      </div>
      {previewDisabledReason && <p className="text-[12px] text-[#B45309]">{previewDisabledReason}</p>}
    </section>
  );
}
