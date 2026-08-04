import { getSettings } from "./storage";

type LockCallback = () => void | Promise<void>;

let onLock: LockCallback | null = null;
const ALARM_NAME = "thruShield:autoLock";
export const AUTO_LOCK_EXPIRY_KEY = "thruShield:autoLockExpiresAt";
const MIN_AUTO_LOCK_MS = 10 * 60 * 1000;

function createAutoLockAlarm(expiresAt: number): void {
  chrome.alarms.create(ALARM_NAME, { when: expiresAt });
}

export function registerAutoLockHandler(callback: LockCallback): void {
  onLock = callback;
}

export async function resetAutoLockTimer(): Promise<void> {
  const settings = await getSettings();
  const expiresAt = Date.now() + Math.max(settings.autoLockMs, MIN_AUTO_LOCK_MS);

  // Clear any existing alarm then create a new one
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.storage.session.set({ [AUTO_LOCK_EXPIRY_KEY]: expiresAt });
  createAutoLockAlarm(expiresAt);
}

export async function restoreAutoLockTimer(expiresAt: number): Promise<void> {
  await chrome.alarms.clear(ALARM_NAME);
  createAutoLockAlarm(expiresAt);
}

export async function cancelAutoLockTimer(): Promise<void> {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.storage.session.remove(AUTO_LOCK_EXPIRY_KEY);
}

// Listen for the alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void onLock?.();
  }
});