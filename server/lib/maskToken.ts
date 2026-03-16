/**
 * Mask sensitive values for logs and API responses.
 * Never expose full token in responses or logs.
 */
export function maskToken(value: string): string {
  if (!value || value.length <= 8) return '••••••••';
  return value.slice(0, 4) + '••••••••' + value.slice(-4);
}

export function maskTokenForResponse(value: string): { masked: boolean } {
  return { masked: value.length > 0 };
}
