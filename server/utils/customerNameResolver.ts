export type OperationalCustomerNameSource =
  | 'conversation_customer_name'
  | 'whatsapp_display_name'
  | 'contact_full_name'
  | 'contact_first_name'
  | 'phone'
  | 'fallback_label';

export interface ResolveOperationalCustomerNameInput {
  conversationCustomerName?: string | null;
  whatsappDisplayName?: string | null;
  contactFullName?: string | null;
  contactFirstName?: string | null;
  phone?: string | null;
  fallbackLabel?: string | null;
}

function cleanName(value: string | null | undefined, max = 255): string | null {
  const compact = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return null;
  return compact.slice(0, max);
}

export function resolveOperationalCustomerNameParts(
  input: ResolveOperationalCustomerNameInput
): { value: string; source: OperationalCustomerNameSource } {
  const ordered: Array<{ value: string | null; source: OperationalCustomerNameSource }> = [
    { value: cleanName(input.conversationCustomerName), source: 'conversation_customer_name' },
    { value: cleanName(input.whatsappDisplayName), source: 'whatsapp_display_name' },
    { value: cleanName(input.contactFullName), source: 'contact_full_name' },
    { value: cleanName(input.contactFirstName), source: 'contact_first_name' },
    { value: cleanName(input.phone, 64), source: 'phone' },
  ];
  for (const item of ordered) {
    if (item.value) return { value: item.value, source: item.source };
  }
  const fallback = cleanName(input.fallbackLabel ?? 'Cliente', 64) ?? 'Cliente';
  return { value: fallback, source: 'fallback_label' };
}

export function resolveOperationalCustomerName(input: ResolveOperationalCustomerNameInput): string {
  return resolveOperationalCustomerNameParts(input).value;
}

/**
 * Nome de exibição seguro para UI/templates operacionais.
 * Nunca retorna "Cliente" quando já existe nome disponível em qualquer origem acima.
 */
export function resolveSafeDisplayName(input: ResolveOperationalCustomerNameInput): string {
  return resolveOperationalCustomerName({
    ...input,
    fallbackLabel: input.fallbackLabel ?? 'Cliente',
  });
}

export function hasHumanResolvedName(source: OperationalCustomerNameSource): boolean {
  return (
    source === 'conversation_customer_name' ||
    source === 'whatsapp_display_name' ||
    source === 'contact_full_name' ||
    source === 'contact_first_name'
  );
}

