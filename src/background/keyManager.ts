import { MnemonicGenerator, ThruHDWallet } from "@thru/crypto";
import { keys, Pubkey, Transaction } from "@thru/thru-sdk";
import type { DecodedTransactionPreview, WalletAccountSummary } from "../types/messages";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  decryptVault,
  encryptVault,
  hexToBytes,
  normalizeVaultPlaintext,
  secureZero,
  type VaultAccount,
  type VaultPlaintext,
} from "../utils/crypto";
import { cancelAutoLockTimer, resetAutoLockTimer } from "./autoLock";
import { clearVault, getVault, saveVault } from "./storage";

export interface UnlockedKeyMaterial {
  accountId: string;
  name: string;
  accountIndex: number;
  address: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  secretKey: Uint8Array;
}

let unlockedKeys: UnlockedKeyMaterial | null = null;
/** Decrypted vault kept in memory only while unlocked (never persisted plain). */
let unlockedVault: VaultPlaintext | null = null;

let vaultExistsCache = false;

export function isWalletInitialized(): boolean {
  return vaultExistsCache;
}

async function refreshVaultCache(): Promise<boolean> {
  const vault = await getVault();
  vaultExistsCache = vault !== null;
  return vaultExistsCache;
}

export async function initializeVaultCache(): Promise<void> {
  await refreshVaultCache();
}

export function isWalletUnlocked(): boolean {
  return unlockedKeys !== null && unlockedVault !== null;
}

export function getUnlockedPublicKey(): string | null {
  return unlockedKeys?.address ?? null;
}

export function getUnlockedKeyMaterial(): UnlockedKeyMaterial | null {
  return unlockedKeys;
}

export function getWalletAccounts(): WalletAccountSummary[] {
  if (!unlockedVault || !unlockedKeys) {
    return [];
  }

  return unlockedVault.accounts.map((account) => ({
    id: account.id,
    name: account.name,
    address: account.address,
    accountIndex: account.accountIndex,
    isActive: account.id === unlockedKeys!.accountId,
  }));
}

function clearUnlockedMnemonic(): void {
  unlockedVault = null;
}

export function lockWallet(): void {
  if (unlockedKeys) {
    secureZero(unlockedKeys.publicKey);
    secureZero(unlockedKeys.privateKey);
    secureZero(unlockedKeys.secretKey);
    unlockedKeys = null;
  }
  clearUnlockedMnemonic();
  cancelAutoLockTimer();
}

async function deriveAccountKeys(
  mnemonic: string,
  accountIndex: number,
): Promise<{
  address: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  secretKey: Uint8Array;
}> {
  const seed = MnemonicGenerator.toSeed(mnemonic);
  try {
    const account = await ThruHDWallet.getAccount(seed, accountIndex);
    return {
      address: account.address,
      publicKey: account.publicKey,
      privateKey: account.privateKey,
      secretKey: account.secretKey,
    };
  } finally {
    secureZero(seed);
  }
}

async function activateAccount(vault: VaultPlaintext, accountId: string): Promise<void> {
  const account = vault.accounts.find((entry) => entry.id === accountId);
  if (!account) {
    throw new Error("Account not found");
  }

  let derived: { address: string; publicKey: Uint8Array; privateKey: Uint8Array; secretKey: Uint8Array };

  // Check if this account was imported via private key
  const importedKeyHex = vault.importedKeys?.[accountId];
  if (importedKeyHex && account.importedViaPrivateKey) {
    derived = await deriveKeysFromPrivateKey(importedKeyHex);
  } else {
    derived = await deriveAccountKeys(vault.mnemonic, account.accountIndex);
  }

  if (unlockedKeys) {
    secureZero(unlockedKeys.publicKey);
    secureZero(unlockedKeys.privateKey);
    secureZero(unlockedKeys.secretKey);
  }

  // Backfill address if missing (legacy migration)
  if (!account.address) {
    account.address = derived.address;
  }

  unlockedVault = vault;
  unlockedKeys = {
    accountId: account.id,
    name: account.name,
    accountIndex: account.accountIndex,
    address: account.address || derived.address,
    publicKey: derived.publicKey,
    privateKey: derived.privateKey,
    secretKey: derived.secretKey,
  };
}

async function deriveKeysFromPrivateKey(
  privateKeyHex: string,
): Promise<{ address: string; publicKey: Uint8Array; privateKey: Uint8Array; secretKey: Uint8Array }> {
  const privateKey = hexToBytes(privateKeyHex);
  if (privateKey.length !== 32) {
    throw new Error("Private key must be 32 bytes");
  }

  const publicKey = await keys.fromPrivateKey(privateKey);
  const address = Pubkey.from(publicKey).toThruFmt();

  // Ed25519 secret key = private key (32 bytes) + public key (32 bytes)
  const secretKey = new Uint8Array(64);
  secretKey.set(privateKey, 0);
  secretKey.set(publicKey, 32);

  return { address, publicKey, privateKey, secretKey };
}

async function persistVault(password: string, vault: VaultPlaintext): Promise<void> {
  const encrypted = await encryptVault(password, vault);
  await saveVault(encrypted);
  vaultExistsCache = true;
}

export async function createWallet(
  password: string,
  mnemonic?: string,
): Promise<{ mnemonic: string; address: string }> {
  const phrase = mnemonic ?? MnemonicGenerator.generate();
  if (!MnemonicGenerator.validate(phrase)) {
    throw new Error("Invalid mnemonic phrase");
  }

  const derived = await deriveAccountKeys(phrase, 0);
  const accountId = crypto.randomUUID();
  const vault: VaultPlaintext = {
    version: 2,
    mnemonic: phrase,
    accounts: [
      {
        id: accountId,
        name: "Account 1",
        accountIndex: 0,
        address: derived.address,
      },
    ],
    activeAccountId: accountId,
  };

  await persistVault(password, vault);
  await activateAccount(vault, accountId);
  await resetAutoLockTimer();

  secureZero(derived.publicKey);
  secureZero(derived.privateKey);
  secureZero(derived.secretKey);

  return { mnemonic: phrase, address: unlockedKeys!.address };
}

export async function importWallet(
  password: string,
  mnemonic: string,
): Promise<{ address: string }> {
  if (!MnemonicGenerator.validate(mnemonic)) {
    throw new Error("Invalid mnemonic phrase");
  }

  return createWallet(password, mnemonic.trim());
}

export async function importWalletFromPrivateKey(
  password: string,
  privateKeyHex: string,
  name?: string,
): Promise<{ address: string }> {
  const sanitized = privateKeyHex.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(sanitized)) {
    throw new Error("Private key must be a 64-character hex string (32 bytes)");
  }

  const { address, publicKey, privateKey, secretKey } = await deriveKeysFromPrivateKey(sanitized);

  const existingVault = await getVault();
  let vault: VaultPlaintext;

  if (existingVault) {
    // Wallet already exists — verify password by decrypting
    const raw = await decryptVault(password, existingVault);
    vault = normalizeVaultPlaintext(raw);

    // Check for duplicate address
    if (vault.accounts.some((a) => a.address === address)) {
      throw new Error("An account with this private key already exists");
    }

    const accountId = crypto.randomUUID();
    const account: VaultAccount = {
      id: accountId,
      name: name?.trim() || `Imported Account ${vault.accounts.length + 1}`,
      accountIndex: vault.accounts.reduce((max, a) => Math.max(max, a.accountIndex), -1) + 1,
      address,
      importedViaPrivateKey: true,
    };

    vault = {
      ...vault,
      accounts: [...vault.accounts, account],
      activeAccountId: account.id,
      importedKeys: {
        ...vault.importedKeys,
        [accountId]: sanitized,
      },
    };

    await persistVault(password, vault);
  } else {
    // First-time setup via private key import — generate a mnemonic for vault structure
    const mnemonic = MnemonicGenerator.generate();

    const accountId = crypto.randomUUID();
    const account: VaultAccount = {
      id: accountId,
      name: name?.trim() || "Imported Account 1",
      accountIndex: 0,
      address,
      importedViaPrivateKey: true,
    };

    vault = {
      version: 2,
      mnemonic,
      accounts: [account],
      activeAccountId: accountId,
      importedKeys: {
        [accountId]: sanitized,
      },
    };

    await persistVault(password, vault);
  }

  await activateAccount(vault, vault.activeAccountId);
  await resetAutoLockTimer();

  secureZero(publicKey);
  secureZero(privateKey);
  secureZero(secretKey);

  return { address: unlockedKeys!.address };
}

export async function unlockWallet(password: string): Promise<{ address: string }> {
  const vault = await getVault();
  if (!vault) {
    throw new Error("Wallet not initialized");
  }

  const raw = await decryptVault(password, vault);
  let plaintext = normalizeVaultPlaintext(raw);

  // Ensure every account has an address (legacy / incomplete entries)
  for (const account of plaintext.accounts) {
    if (!account.address) {
      const derived = await deriveAccountKeys(plaintext.mnemonic, account.accountIndex);
      account.address = derived.address;
      secureZero(derived.publicKey);
      secureZero(derived.privateKey);
      secureZero(derived.secretKey);
    }
  }

  // Persist migrated v2 vault if needed
  if (!("version" in raw) || (raw as VaultPlaintext).version !== 2) {
    await persistVault(password, plaintext);
  }

  const activeId =
    plaintext.accounts.find((a) => a.id === plaintext.activeAccountId)?.id ??
    plaintext.accounts[0]?.id;

  if (!activeId) {
    throw new Error("Vault has no accounts");
  }

  plaintext.activeAccountId = activeId;
  await activateAccount(plaintext, activeId);
  await resetAutoLockTimer();
  return { address: unlockedKeys!.address };
}

/**
 * Derive and add another HD account under the existing mnemonic.
 * Requires password to re-encrypt the vault.
 */
export async function addAccount(
  password: string,
  name?: string,
): Promise<{ account: WalletAccountSummary; mnemonicReminder: null }> {
  if (!unlockedVault) {
    throw new Error("Wallet is locked");
  }

  // Verify password by decrypting current vault
  const encrypted = await getVault();
  if (!encrypted) {
    throw new Error("Wallet not initialized");
  }
  await decryptVault(password, encrypted);

  const nextIndex =
    unlockedVault.accounts.reduce((max, account) => Math.max(max, account.accountIndex), -1) + 1;

  const derived = await deriveAccountKeys(unlockedVault.mnemonic, nextIndex);
  const account: VaultAccount = {
    id: crypto.randomUUID(),
    name: name?.trim() || `Account ${unlockedVault.accounts.length + 1}`,
    accountIndex: nextIndex,
    address: derived.address,
  };

  const updated: VaultPlaintext = {
    ...unlockedVault,
    accounts: [...unlockedVault.accounts, account],
    activeAccountId: account.id,
  };

  await persistVault(password, updated);
  await activateAccount(updated, account.id);
  await resetAutoLockTimer();

  secureZero(derived.publicKey);
  secureZero(derived.privateKey);
  secureZero(derived.secretKey);

  return {
    account: {
      id: account.id,
      name: account.name,
      address: account.address,
      accountIndex: account.accountIndex,
      isActive: true,
    },
    mnemonicReminder: null,
  };
}

export async function switchAccount(accountId: string): Promise<{ address: string }> {
  if (!unlockedVault) {
    throw new Error("Wallet is locked");
  }

  if (!unlockedVault.accounts.some((account) => account.id === accountId)) {
    throw new Error("Account not found");
  }

  unlockedVault = {
    ...unlockedVault,
    activeAccountId: accountId,
  };

  await activateAccount(unlockedVault, accountId);
  await resetAutoLockTimer();

  // Persist active selection without password by re-reading is not possible encrypted;
  // store activeAccountId in a separate non-secret preference.
  await chrome.storage.local.set({ "thruShield:activeAccountId": accountId });

  return { address: unlockedKeys!.address };
}

/**
 * Export the active account private key as hex.
 * Requires password confirmation.
 */
export async function exportPrivateKey(password: string): Promise<{
  address: string;
  privateKeyHex: string;
  accountName: string;
}> {
  if (!unlockedKeys || !unlockedVault) {
    throw new Error("Wallet is locked");
  }

  const encrypted = await getVault();
  if (!encrypted) {
    throw new Error("Wallet not initialized");
  }

  // Verify password — do not return keys on failure
  await decryptVault(password, encrypted);
  await resetAutoLockTimer();

  return {
    address: unlockedKeys.address,
    accountName: unlockedKeys.name,
    privateKeyHex: bytesToHex(unlockedKeys.privateKey),
  };
}

export function decodeTransactionPreview(base64Payload: string): DecodedTransactionPreview {
  const bytes = base64ToBytes(base64Payload);
  const tx = Transaction.fromWire(bytes);

  return {
    feePayer: Pubkey.from(tx.feePayer).toThruFmt(),
    program: Pubkey.from(tx.program).toThruFmt(),
    gasLimit: tx.requestedComputeUnits,
    stateUnits: tx.requestedStateUnits,
    memoryUnits: tx.requestedMemoryUnits,
    chainId: tx.chainId,
    instructionDataHex: tx.instructionData ? bytesToHex(tx.instructionData) : "",
    instructionDataSize: tx.instructionDataSize ?? tx.instructionData?.length ?? 0,
    readWriteAccounts: tx.readWriteAccounts.map((key) => Pubkey.from(key).toThruFmt()),
    readOnlyAccounts: tx.readOnlyAccounts.map((key) => Pubkey.from(key).toThruFmt()),
  };
}

export async function signTransactionPayload(base64Payload: string): Promise<string> {
  if (!unlockedKeys) {
    throw Object.assign(new Error("Wallet is locked"), { code: "WALLET_LOCKED" as const });
  }

  await resetAutoLockTimer();

  const bytes = base64ToBytes(base64Payload);
  const tx = Transaction.fromWire(bytes);
  await tx.sign(unlockedKeys.privateKey);
  return bytesToBase64(tx.toWire());
}

export function getSigningContextForWallet() {
  if (!unlockedKeys) {
    throw Object.assign(new Error("Wallet is locked"), { code: "WALLET_LOCKED" as const });
  }

  return {
    mode: "managed_fee_payer" as const,
    selectedAccountPublicKey: unlockedKeys.address,
    feePayerPublicKey: unlockedKeys.address,
    signerPublicKey: unlockedKeys.address,
    acceptedInputEncodings: ["signing_payload_base64", "raw_transaction_base64"] as const,
    outputEncoding: "raw_transaction_base64" as const,
  };
}

export async function wipeWallet(): Promise<void> {
  lockWallet();
  await clearVault();
  vaultExistsCache = false;
  await chrome.storage.local.remove("thruShield:activeAccountId");
}
