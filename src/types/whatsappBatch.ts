export interface BatchTemplateVariableDef {
  id: number;
  label: string;
  required: boolean;
}

export interface BatchTemplateCatalogItem {
  key: string;
  name: string;
  languageCode: 'pt_BR';
  variables: BatchTemplateVariableDef[];
}

export type TemplateVariableSource =
  | { type: 'column'; columnName: string }
  | { type: 'fixed'; fixedValue: string }
  | { type: 'enterprise'; enterpriseField: 'name' };

export interface BatchMappingConfig {
  templateKey: string;
  phoneColumn: string;
  selectedEnterpriseId?: number | null;
  variableMappings: Record<string, TemplateVariableSource>;
}

export interface BatchParseResponse {
  headers: string[];
  rowCount: number;
  sampleRows: Record<string, string>[];
  suggestions: {
    phoneColumn: string | null;
    customerNameColumn: string | null;
    enterpriseColumn: string | null;
  };
  templateKey: string | null;
}

export interface BatchPreviewRow {
  rowNumber: number;
  phoneOriginal: string | null;
  phoneNormalized: string | null;
  isValid: boolean;
  status: 'valid' | 'invalid' | 'blocked';
  error: string | null;
  resolvedVariables: Array<{
    variableId: number;
    label: string;
    value: string | null;
    sourceType: 'column' | 'fixed' | 'enterprise';
    sourceLabel: string;
  }>;
}

export interface BatchPreviewResponse {
  total: number;
  validCount: number;
  invalidCount: number;
  blockedCount: number;
  rows: BatchPreviewRow[];
}

export interface BatchTestResponse {
  success: boolean;
  phoneOriginal: string;
  phoneNormalized: string | null;
  error: string | null;
  mode: 'row' | 'manual';
  sampleRowNumber?: number;
  resolvedVariables: Array<{
    variableId: number;
    label: string;
    value: string | null;
    sourceType: 'column' | 'fixed' | 'enterprise';
    sourceLabel: string;
  }>;
  metaMessageId?: string;
}

export interface BatchSendResponse {
  total: number;
  success: number;
  failed: number;
  details: Array<{
    rowNumber: number;
    phoneOriginal: string | null;
    phoneNormalized: string | null;
    status: 'sent' | 'blocked' | 'error';
    error: string | null;
    metaMessageId?: string;
  }>;
}
