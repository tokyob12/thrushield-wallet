import type { AuthorizedDApp } from "../types/messages";
import type { EncryptedPayload } from "../utils/crypto";

const VAULT_KEY = "thruShield:vault";
const AUTHORIZED_DAPPS_KEY = "thruShield:authorizedDapps";
const SETTINGS_KEY = "thruShield:settings";

export interface WalletSettings {
  autoLockMs: number;
}

const DEFAULT_SETTINGS: WalletSettings = {
  autoLockMs: 15 * 60 * 1000,
};

export async function getVault(): Promise<EncryptedPayload | null> {
  const result = await chrome.storage.local.get(VAULT_KEY);
  return (result[VAULT_KEY] as EncryptedPayload | undefined) ?? null;
}

export async function saveVault(vault: EncryptedPayload): Promise<void> {
  await chrome.storage.local.set({ [VAULT_KEY]: vault });
}

export async function clearVault(): Promise<void> {
  await chrome.storage.local.remove(VAULT_KEY);
}

export async function getAuthorizedDApps(): Promise<AuthorizedDApp[]> {
  const result = await chrome.storage.local.get(AUTHORIZED_DAPPS_KEY);
  return (result[AUTHORIZED_DAPPS_KEY] as AuthorizedDApp[] | undefined) ?? [];
}

export async function saveAuthorizedDApp(dapp: AuthorizedDApp): Promise<void> {
  const existing = await getAuthorizedDApps();
  const filtered = existing.filter((entry) => entry.origin !== dapp.origin);
  filtered.push(dapp);
  await chrome.storage.local.set({ [AUTHORIZED_DAPPS_KEY]: filtered });
}

export async function removeAuthorizedDApp(origin: string): Promise<void> {
  const existing = await getAuthorizedDApps();
  const filtered = existing.filter((entry) => entry.origin !== origin);
  await chrome.storage.local.set({ [AUTHORIZED_DAPPS_KEY]: filtered });
}

export async function isOriginAuthorized(origin: string): Promise<boolean> {
  const dapps = await getAuthorizedDApps();
  return dapps.some((entry) => entry.origin === origin);
}

export async function getSettings(): Promise<WalletSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] as WalletSettings | undefined) };
}

export async function saveSettings(settings: Partial<WalletSettings>): Promise<void> {
  const current = await getSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, ...settings } });
}