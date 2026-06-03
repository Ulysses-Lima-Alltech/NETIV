export const FILE_KINDS = [
  'canonical_sales_script',
  'faq',
  'product_summary',
  'brochure',
  'price_table',
  'floorplan',
  'legacy_support_material',
  'unknown',
] as const;

export type FileKind = (typeof FILE_KINDS)[number];

export const PROCESSING_STATUSES = ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'SKIPPED'] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export interface IngestionClassificationInput {
  enterpriseName: string;
  originalName: string;
  mimeType: string;
  storageProvider: string | null;
  existingSource: string | null;
  existingSourcePriority: number | null;
  existingCanBeSentByAna: boolean;
  existingCanBeUsedAsKnowledge: boolean;
  existingIsActive: boolean;
}

export interface IngestionClassificationResult {
  fileKind: FileKind;
  source: string;
  sourcePriority: number;
  canBeSentByAna: boolean;
  canBeUsedAsKnowledge: boolean;
  isActive: boolean;
  isCanonicalForEnterprise: boolean;
}

function normalizeToken(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function inferFileKind(name: string, mimeType: string): FileKind {
  const n = normalizeToken(name);
  const mime = String(mimeType || '').toLowerCase();

  if (/\bscript\b/.test(n) || /\broteiro\b/.test(n)) return 'canonical_sales_script';
  if (/\bfaq\b/.test(n) || /\bperguntas frequentes\b/.test(n)) return 'faq';
  if (/\bresumo\b/.test(n) || /\bsummary\b/.test(n) || /\boverview\b/.test(n)) return 'product_summary';
  if (/\bbook\b/.test(n) || /\bbrochure\b/.test(n) || /\bcatalogo\b/.test(n) || /\bapresentacao\b/.test(n)) {
    return 'brochure';
  }
  if (/\btabela\b/.test(n) || /\bpreco\b/.test(n) || /\bpricing\b/.test(n)) return 'price_table';
  if (/\bplanta\b/.test(n) || /\bfloorplan\b/.test(n)) return 'floorplan';

  if (mime.startsWith('text/plain') || mime.startsWith('text/markdown')) return 'legacy_support_material';
  if (mime.includes('pdf') || mime.includes('wordprocessingml') || mime.startsWith('text/html')) {
    return 'legacy_support_material';
  }

  return 'unknown';
}

function defaultPriorityByKind(kind: FileKind): number {
  switch (kind) {
    case 'canonical_sales_script':
      return 100;
    case 'faq':
      return 85;
    case 'product_summary':
      return 75;
    case 'brochure':
      return 70;
    case 'price_table':
      return 80;
    case 'floorplan':
      return 60;
    case 'legacy_support_material':
      return 40;
    case 'unknown':
    default:
      return 20;
  }
}

function defaultSource(storageProvider: string | null): string {
  const provider = String(storageProvider || '').toLowerCase();
  if (provider === 'r2') return 'legacy_r2_import';
  if (provider === 's3') return 's3_import';
  if (provider === 'local') return 'local_import';
  return 'legacy_import';
}

export function classifyMaterialForIngestion(input: IngestionClassificationInput): IngestionClassificationResult {
  const fileKind = inferFileKind(input.originalName, input.mimeType);
  const enterprise = normalizeToken(input.enterpriseName);
  const fileName = normalizeToken(input.originalName);

  const isEvoraCanonicalScript =
    enterprise.includes('evora') &&
    fileName.includes('script') &&
    fileName.includes('evora');
  const isEvoraCanonicalV12Base =
    enterprise.includes('evora') &&
    fileName.includes('base unica ana evora v1 2');
  const isEvoraLegacyExamples =
    enterprise.includes('evora') &&
    /^exemplos(?:\s|$)/.test(fileName);

  if (isEvoraCanonicalScript || isEvoraCanonicalV12Base) {
    return {
      fileKind: 'canonical_sales_script',
      source: 'client_approved_script',
      sourcePriority: isEvoraCanonicalV12Base ? 1200 : 1000,
      canBeSentByAna: input.existingCanBeSentByAna,
      canBeUsedAsKnowledge: true,
      isActive: input.existingIsActive,
      isCanonicalForEnterprise: true,
    };
  }

  if (isEvoraLegacyExamples) {
    return {
      fileKind,
      source: input.existingSource?.trim() || defaultSource(input.storageProvider),
      sourcePriority: Math.min(input.existingSourcePriority ?? defaultPriorityByKind(fileKind), 10),
      canBeSentByAna: input.existingCanBeSentByAna,
      canBeUsedAsKnowledge: false,
      isActive: input.existingIsActive,
      isCanonicalForEnterprise: false,
    };
  }

  return {
    fileKind,
    source: input.existingSource?.trim() || defaultSource(input.storageProvider),
    sourcePriority: input.existingSourcePriority ?? defaultPriorityByKind(fileKind),
    canBeSentByAna: input.existingCanBeSentByAna,
    canBeUsedAsKnowledge: input.existingCanBeUsedAsKnowledge,
    isActive: input.existingIsActive,
    isCanonicalForEnterprise: fileKind === 'canonical_sales_script',
  };
}

export function canConflictWithCanonicalFacts(fileKind: FileKind): boolean {
  return (
    fileKind === 'canonical_sales_script' ||
    fileKind === 'product_summary' ||
    fileKind === 'brochure' ||
    fileKind === 'legacy_support_material' ||
    fileKind === 'unknown'
  );
}

