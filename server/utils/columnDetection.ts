export interface BatchColumnSuggestions {
  phone: string[];
  name: string[];
  email: string[];
  city: string[];
  enterprise: string[];
  broker: string[];
  generic: string[];
}

const PHONE_PATTERNS = [
  /telefone/i,
  /phone/i,
  /celular/i,
  /whatsapp/i,
  /contato/i,
  /fone/i,
];

const NAME_PATTERNS = [
  /nome/i,
  /name/i,
  /cliente/i,
  /contato/i,
  /pessoa/i,
];

const EMAIL_PATTERNS = [
  /email/i,
  /e[-_]?mail/i,
  /correio/i,
];

const CITY_PATTERNS = [
  /cidade/i,
  /city/i,
  /localidade/i,
  /municipio/i,
];

const ENTERPRISE_PATTERNS = [
  /empreendimento/i,
  /enterprise/i,
  /empreendimento/i,
  /projeto/i,
  /loteamento/i,
];

const BROKER_PATTERNS = [
  /corretor/i,
  /broker/i,
  /vendedor/i,
  /consultor/i,
  /agente/i,
];

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

export function detectBatchColumns(headers: string[]): BatchColumnSuggestions {
  const suggestions: BatchColumnSuggestions = {
    phone: [],
    name: [],
    email: [],
    city: [],
    enterprise: [],
    broker: [],
    generic: [],
  };

  for (const header of headers) {
    const normalized = header.trim().toLowerCase();
    
    if (matchesAnyPattern(normalized, PHONE_PATTERNS)) {
      suggestions.phone.push(header);
    } else if (matchesAnyPattern(normalized, NAME_PATTERNS)) {
      suggestions.name.push(header);
    } else if (matchesAnyPattern(normalized, EMAIL_PATTERNS)) {
      suggestions.email.push(header);
    } else if (matchesAnyPattern(normalized, CITY_PATTERNS)) {
      suggestions.city.push(header);
    } else if (matchesAnyPattern(normalized, ENTERPRISE_PATTERNS)) {
      suggestions.enterprise.push(header);
    } else if (matchesAnyPattern(normalized, BROKER_PATTERNS)) {
      suggestions.broker.push(header);
    } else {
      suggestions.generic.push(header);
    }
  }

  return suggestions;
}
