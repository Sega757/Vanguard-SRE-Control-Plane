const PREF_KEY = 'vanguard_web_notifications_enabled';

export type BrowserNotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function isNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): BrowserNotificationPermission {
  if (!isNotificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export function getNotificationsPreference(): boolean {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setNotificationsPreference(enabled: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage restriction in sandboxed iframes
  }
}

export async function requestNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (!isNotificationsSupported()) return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

export function sendBrowserNotification(
  title: string,
  body: string,
  options?: { tag?: string; force?: boolean }
): boolean {
  if (!isNotificationsSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  if (!options?.force && !getNotificationsPreference()) return false;

  try {
    const n = new Notification(title, {
      body: body.slice(0, 220),
      tag: options?.tag || 'vanguard-sre',
      silent: false,
    });
    window.setTimeout(() => n.close(), 8000);
    return true;
  } catch {
    return false;
  }
}
