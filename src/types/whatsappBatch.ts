export interface WhatsAppTemplateVariableDef {
  id: number;
  label: string;
  required: boolean;
}

export interface BatchTemplateCatalogItem {
  key: string;
  name: string;
  languageCode: string;
  category?: string;
  status?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  metaTemplateId?: string;
  components?: Array<Record<string, unknown>>;
  hasHeaderImage?: boolean;
  hasHeaderVideo?: boolean;
  hasHeaderDocument?: boolean;
  hasBodyVariables?: boolean;
  bodyVariableCount?: number;
  hasButtons?: boolean;
  requiresHeaderMedia?: boolean;
  headerImageUrl?: string;
  variables: WhatsAppTemplateVariableDef[];
  /** Corpo com {{1}}, {{2}}… (opcional; inbox usa fallback por label se ausente). */
  messageBodyTemplate?: string;
}

export interface TemplateVariableSource {
  type: 'column' | 'fixed' | 'enterprise';
  columnName?: string;
  fixedValue?: string;
}

export interface BatchMappingConfig {
  templateKey: string;
  phoneColumn: string;
  selectedEnterpriseId?: number | null;
  selectedBrokerId?: number | null;
  selectedBrokerIds?: number[];
  variableMappings: Record<string, TemplateVariableSource>;
}

export interface BatchParseResponse {
  spreadsheet: {
    headers: string[];
    rowCount: number;
    sampleRows: Record<string, string>[];
    /** Linhas completas (necessárias para preview/envio no servidor). */
    rows: Record<string, string>[];
  };
  suggestions: {
    phoneColumn: string;
    customerNameColumn?: string;
    enterpriseColumn?: string;
  };
}

export interface BatchPreviewRow {
  rowIndex: number;
  rowNumber: number;
  phoneOriginal: string | null;
  phoneNormalized: string | null;
  isValid: boolean;
  status: 'valid' | 'invalid' | 'blocked';
  error: string | null;
  assignedBrokerId?: number | null;
  assignedBrokerName?: string | null;
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

export interface BatchSendResult {
  total: number;
  success: number;
  failed: number;
  details: Array<{
    rowNumber: number;
    phoneOriginal: string | null;
    phoneNormalized: string | null;
    status: 'sent' | 'blocked' | 'error';
    error: string | null;
    errorCode?: number;
    errorType?: string;
    httpStatus?: number;
    templateKey: string;
    metaMessageId?: string;
  }>;
}

export interface BatchTestResult {
  success: boolean;
  phoneOriginal: string;
  phoneNormalized: string | null;
  error: string | null;
  templateKey: string;
  mode: 'row' | 'manual';
  sampleRowNumber?: number;
  resolvedVariables: BatchPreviewRow['resolvedVariables'];
  errorCode?: number;
  errorType?: string;
  httpStatus?: number;
  metaMessageId?: string;
}
