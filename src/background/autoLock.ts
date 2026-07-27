import { getSettings } from "./storage";

type LockCallback = () => void;

let onLock: LockCallback | null = null;
const ALARM_NAME = "thruShield:autoLock";

export function registerAutoLockHandler(callback: LockCallback): void {
  onLock = callback;
}

export async function resetAutoLockTimer(): Promise<void> {
  const settings = await getSettings();
  const delayMinutes = settings.autoLockMs / 60_000;

  // Clear any existing alarm then create a new one
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: delayMinutes });
}

export function cancelAutoLockTimer(): void {
  chrome.alarms.clear(ALARM_NAME);
}

// Listen for the alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    onLock?.();
  }
});