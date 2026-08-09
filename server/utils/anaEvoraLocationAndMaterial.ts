import { normText } from './anaTextNormalize.js';
import {
  userAskedForSpecificImageFilenameTopic,
  userAskedForSpecificMediaSpace,
} from './anaDocSendIntent.js';

export function hasUnsupportedLocationPromise(text: string | null | undefined): boolean {
  const n = normText(String(text ?? '')).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return false;
  return (
    /ponto\s+de\s+refer(?:e|ê)ncia/.test(n) ||
    /refer(?:e|ê)ncia\s+(?:no\s+)?trajeto/.test(n) ||
    /refer(?:e|ê)ncia\s+(?:pela\s+)?dom\s+pedro\s+i/.test(n) ||
    /refer(?:e|ê)ncia\s+de\s+acesso/.test(n) ||
    /posso\s+te\s+explicar\s+o\s+trajeto/.test(n)
  );
}

export function isLocationLinkRequest(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return /\b(tem o link da localizacao|tem link da localizacao|link da localizacao|link de localizacao|link com a localizacao|google maps|maps|mapa|rota|como chegar|manda localizacao|manda a localizacao|manda a localizacao pfv|me envia a localizacao|me envia localizacao|me manda localizacao|me manda a localizacao|nao entendi onde fica|localizacao exata|endereco com numero|tem numero|numero do endereco|tem o endereco|me passa o endereco|qual o endereco)\b/.test(
    n
  );
}

export function isImageMaterialRequest(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return (
    /\b(foto|fotos|imagem|imagens|manda foto|tem foto|quero ver|galeria)\b/.test(n) ||
    userAskedForSpecificImageFilenameTopic(text) ||
    userAskedForSpecificMediaSpace(text)
  );
}

export const ANA_IMAGE_NOT_FOUND_REPLY =
  'Ainda não encontrei essa foto cadastrada aqui, mas posso te passar as informações do espaço.';

export function isVideoMaterialRequest(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return /\b(video|videos|vídeo|vídeos|manda video|manda vídeo|tem video|tem vídeo|tour|video do empreendimento|vídeo do empreendimento|quero ver o empreendimento)\b/.test(n);
}

export function isProactiveVideoOfferIntent(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return /\b(visao geral|visão geral|lazer|fotos|imagens|localizacao|localização|quero ver|me mostra|como e|como é|tem video|tem vídeo)\b/.test(n);
}

export function pickAuthorizedLocationLink(vars: Record<string, unknown>): string | null {
  const entries = Object.entries(vars || {});
  const normalizedKey = (key: string): string =>
    normText(key)
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const exactPriorityKeys = new Set([
    'google_maps_url',
    'location_url',
    'maps_url',
    'localizacao_link',
    'localizacao_url',
    'link_localizacao',
    'link_google_maps',
    'endereco_google_maps',
    'exact_location_url',
    'exact_location',
    'exactlocation',
    'localizacao_exata',
    'mapa_url',
  ]);
  const exactPriorityCandidates = entries.filter(([k, v]) => {
    const key = normalizedKey(k);
    const val = String(v ?? '').trim();
    if (!val || !/^https?:\/\//i.test(val)) return false;
    return exactPriorityKeys.has(key);
  });
  if (exactPriorityCandidates[0]?.[1]) return String(exactPriorityCandidates[0][1]).trim();

  const candidates = entries.filter(([k, v]) => {
    const key = normalizedKey(k);
    const val = String(v ?? '').trim();
    if (!val) return false;
    if (!/^https?:\/\//i.test(val)) return false;
    return /(mapa|maps|localizacao|google|endereco|rota|exact_location|exactlocation)/.test(key);
  });
  return candidates[0]?.[1] ? String(candidates[0][1]).trim() : null;
}

export function pickAuthorizedLocationAddress(vars: Record<string, unknown>): {
  addressComplete: string | null;
  addressNumber: string | null;
} {
  const entries = Object.entries(vars || {}).map(([key, value]) => [normText(key), String(value ?? '').trim()] as const);
  const findValue = (keys: string[]): string | null => {
    for (const key of keys) {
      const found = entries.find(([k, v]) => k === key && v.length > 0);
      if (found?.[1]) return found[1];
    }
    return null;
  };

  return {
    addressComplete: findValue(['endereco_completo', 'endereco', 'address_full']),
    addressNumber: findValue(['endereco_numero', 'numero_endereco', 'address_number']),
  };
}

export function buildEvoraLocationOverview(args: {
  addressComplete?: string | null;
  addressNumber?: string | null;
}): string {
  const canonicalBase =
    'O Évora fica em Atibaia, na região da Pedreira/Rio Abaixo, com acesso pela Rodovia Dom Pedro I, a cerca de 50 minutos de São Paulo.';
  const addressComplete = String(args.addressComplete ?? '').trim();
  const addressNumber = String(args.addressNumber ?? '').trim();
  if (addressComplete) {
    const addressLabel =
      addressNumber && !addressComplete.includes(addressNumber)
        ? `${addressComplete}, numero ${addressNumber}`
        : addressComplete;
    return `${canonicalBase} Endereco de referencia: ${addressLabel}.`;
  }
  return canonicalBase;
}

export function buildEvoraRegionCanonicalReply(): string {
  return 'O Évora fica em Atibaia, na região da Pedreira/Rio Abaixo, com acesso pela Rodovia Dom Pedro I e a aproximadamente 50 minutos de São Paulo.';
}

export function buildEvoraAddressCanonicalReply(): string {
  return 'Fica na Estrada dos Pires, s/n, na região da Pedreira, bairro Rio Abaixo, em Atibaia.';
}

export function getEvoraCanonicalMapsLink(): string {
  return 'https://maps.app.goo.gl/jBoxPM6XRut2iXHSA?g_st=ic';
}

export function pickLocationLinkFromKnowledge(knowledgeText: string): string | null {
  const raw = String(knowledgeText || '');
  if (!raw.trim()) return null;
  const match = raw.match(/https?:\/\/(?:maps\.app\.goo\.gl|(?:www\.)?google\.[^/\s]+\/maps|maps\.google\.[^/\s]+)[^\s)]+/i);
  return match?.[0]?.trim() || null;
}

export function sanitizeEvoraRestrictedKnowledgeForAna(text: string): string {
  return String(text || '')
    .replace(/^Quantidade total de lotes:\s*\d+\s*$/gim, 'Quantidade total de lotes: informação tratada pelo corretor')
    .replace(/\b145\s+lotes\b/gi, 'quantidade de lotes tratada pelo corretor');
}

export function hasConversationalUnsupportedPromise(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return (
    /(vamos detalhar|detalhar um pouco mais|posso detalhar|te passo|posso te passar|te envio|posso enviar)/.test(n) ||
    /refer(?:e|ê)ncia\s+de\s+acesso/.test(n) ||
    hasUnsupportedLocationPromise(n)
  );
}

export function isBrokenEnumeratedReply(text: string): boolean {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  const last = lines[lines.length - 1] ?? '';
  if (/^(?:-|\*|•)$/.test(last)) return true;
  if (/^\d+\s*[.:)]\s*$/.test(last)) return true;
  return false;
}
