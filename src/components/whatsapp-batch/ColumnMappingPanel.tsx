import type { Corretor, ProjectListItem } from '../../api/client';
import type { BatchTemplateCatalogItem, TemplateVariableSource } from '../../types/whatsappBatch';

interface Props {
  headers: string[];
  suggestions: {
    phoneColumn: string | null;
  } | null;
  template: BatchTemplateCatalogItem | null;
  phoneColumn: string;
  selectedEnterpriseId: string;
  projects: ProjectListItem[];
  brokers: Corretor[];
  variableMappings: Record<string, TemplateVariableSource>;
  onPhoneColumnChange: (value: string) => void;
  onEnterpriseChange: (value: string) => void;
  selectedBrokerId: string;
  onBrokerChange: (value: string) => void;
  onVariableMappingChange: (variableId: string, value: TemplateVariableSource) => void;
}

const inputCls =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px] bg-white focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

export function ColumnMappingPanel(props: Props) {
  const {
    headers,
    suggestions,
    template,
    phoneColumn,
    selectedEnterpriseId,
    projects,
    brokers,
    variableMappings,
    onPhoneColumnChange,
    onEnterpriseChange,
    selectedBrokerId,
    onBrokerChange,
    onVariableMappingChange,
  } = props;

  if (!template) {
    return (
      <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4">
        <p className="text-[13px] text-[#6B7280]">Selecione um template para configurar o mapeamento.</p>
      </section>
    );
  }

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-4">
      <h2 className="text-[14px] font-semibold">Mapeamento de dados</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[12px] text-[#374151] mb-1">Coluna de telefone</label>
          <select className={inputCls} value={phoneColumn} onChange={(e) => onPhoneColumnChange(e.target.value)}>
            <option value="">Selecione</option>
            {headers.map((h) => (
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
          <select className={inputCls} value={selectedEnterpriseId} onChange={(e) => onEnterpriseChange(e.target.value)}>
            <option value="">Nenhum</option>
            {projects.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[12px] text-[#374151] mb-1">Corretor responsável pela base</label>
          <select className={inputCls} value={selectedBrokerId} onChange={(e) => onBrokerChange(e.target.value)}>
            <option value="">Nenhum</option>
            {brokers
              .filter((b) => b.active)
              .map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.fullName}
                </option>
              ))}
          </select>
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
                {'}}'} - {v.label}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <select
                  className={inputCls}
                  value={mapping.type}
                  onChange={(e) => {
                    const type = e.target.value as TemplateVariableSource['type'];
                    if (type === 'column') onVariableMappingChange(String(v.id), { type: 'column', columnName: '' });
                    else if (type === 'fixed') onVariableMappingChange(String(v.id), { type: 'fixed', fixedValue: '' });
                    else onVariableMappingChange(String(v.id), { type: 'enterprise', enterpriseField: 'name' });
                  }}
                >
                  <option value="column">Coluna da planilha</option>
                  <option value="fixed">Valor fixo</option>
                  <option value="enterprise">Cadastro de empreendimento</option>
                </select>
                {mapping.type === 'column' && (
                  <select
                    className={inputCls}
                    value={mapping.columnName}
                    onChange={(e) => onVariableMappingChange(String(v.id), { type: 'column', columnName: e.target.value })}
                  >
                    <option value="">Selecione a coluna</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                )}
                {mapping.type === 'fixed' && (
                  <input
                    className={inputCls}
                    value={mapping.fixedValue}
                    placeholder="Digite o valor fixo"
                    onChange={(e) => onVariableMappingChange(String(v.id), { type: 'fixed', fixedValue: e.target.value })}
                  />
                )}
                {mapping.type === 'enterprise' && (
                  <div className="text-[12px] text-[#6B7280] flex items-center">Usar nome do empreendimento selecionado</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
