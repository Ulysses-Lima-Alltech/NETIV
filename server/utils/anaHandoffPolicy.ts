export function isAnaAutomaticHandoffCreationDisabled(): boolean {
  return String(process.env.ANA_HANDOFF_DISABLED ?? '').trim().toLowerCase() === 'true';
}

export function shouldCreateAutomaticHandoff(): boolean {
  return !isAnaAutomaticHandoffCreationDisabled();
}
