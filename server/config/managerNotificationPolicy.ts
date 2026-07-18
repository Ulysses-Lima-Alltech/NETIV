export const MANAGER_NOTIFICATIONS_ENV_NAME = 'MANAGER_NOTIFICATIONS_ENABLED';

type ManagerNotificationEnvironment = Record<string, string | undefined>;

/**
 * Manager notifications are opt-in. Missing, blank, false, or unknown values
 * must never enable an operational notification to a manager.
 */
export function areManagerNotificationsEnabled(
  env: ManagerNotificationEnvironment = process.env
): boolean {
  const raw = String(env[MANAGER_NOTIFICATIONS_ENV_NAME] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function canReceiveBrokerOperationalNotification(
  role: string | null | undefined,
  env: ManagerNotificationEnvironment = process.env
): boolean {
  const normalizedRole = String(role ?? '').trim().toUpperCase();
  if (normalizedRole === 'CORRETOR') return true;
  if (normalizedRole === 'GESTOR') return areManagerNotificationsEnabled(env);
  return false;
}
