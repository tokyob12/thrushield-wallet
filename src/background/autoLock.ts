import { getSettings } from "./storage";

type LockCallback = () => void;

let lockTimer: ReturnType<typeof setTimeout> | null = null;
let onLock: LockCallback | null = null;

export function registerAutoLockHandler(callback: LockCallback): void {
  onLock = callback;
}

export async function resetAutoLockTimer(): Promise<void> {
  if (lockTimer) {
    clearTimeout(lockTimer);
  }

  const settings = await getSettings();
  lockTimer = setTimeout(() => {
    onLock?.();
  }, settings.autoLockMs);
}

export function cancelAutoLockTimer(): void {
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }
}
