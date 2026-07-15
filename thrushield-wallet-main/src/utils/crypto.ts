/**
 * Industrial-grade encryption utilities for ThruShield vault storage.
 * Uses Web Crypto API (AES-GCM-256 + PBKDF2-SHA256).
 * All operations run exclusively in the background service worker.
 */

const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_LENGTH_BITS = 256;

export interface EncryptedPayload {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}

/** Stored account derived from the vault mnemonic (BIP44 Thru path). */
export interface VaultAccount {
  id: string;
  name: string;
  accountIndex: number;
  address: string;
}

/**
 * Vault plaintext (version 2).
 * Legacy v1 shape `{ mnemonic, accountIndex }` is migrated on unlock.
 */
export interface VaultPlaintext {
  version: 2;
  mnemonic: string;
  accounts: VaultAccount[];
  activeAccountId: string;
}

/** Legacy single-account vault shape */
type LegacyVaultPlaintext = {
  mnemonic: string;
  accountIndex: number;
};

function getCrypto(): Crypto {
  return globalThis.crypto;
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function secureZero(buffer: Uint8Array): void {
  buffer.fill(0);
}

export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const crypto = getCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toBufferSource(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptVault(
  password: string,
  plaintext: VaultPlaintext,
): Promise<EncryptedPayload> {
  const crypto = getCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKeyFromPassword(password, salt);
  const encoder = new TextEncoder();
  const encoded = encoder.encode(JSON.stringify(plaintext));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBufferSource(iv) },
    key,
    toBufferSource(encoded),
  );

  return {
    version: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export function normalizeVaultPlaintext(
  raw: VaultPlaintext | LegacyVaultPlaintext,
  derivedAddress?: string,
): VaultPlaintext {
  if ("version" in raw && raw.version === 2 && Array.isArray(raw.accounts)) {
    return raw;
  }

  const legacy = raw as LegacyVaultPlaintext;
  const id = crypto.randomUUID();
  return {
    version: 2,
    mnemonic: legacy.mnemonic,
    accounts: [
      {
        id,
        name: "Account 1",
        accountIndex: legacy.accountIndex ?? 0,
        address: derivedAddress ?? "",
      },
    ],
    activeAccountId: id,
  };
}

export async function decryptVault(
  password: string,
  payload: EncryptedPayload,
): Promise<VaultPlaintext | LegacyVaultPlaintext> {
  if (payload.version !== 1) {
    throw new Error("Unsupported vault version");
  }

  const cryptoApi = getCrypto();
  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);
  const key = await deriveKeyFromPassword(password, salt);

  let decrypted: ArrayBuffer;
  try {
    decrypted = await cryptoApi.subtle.decrypt(
      { name: "AES-GCM", iv: toBufferSource(iv) },
      key,
      toBufferSource(ciphertext),
    );
  } catch {
    throw new Error("Invalid password or corrupted vault");
  }

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decrypted)) as VaultPlaintext | LegacyVaultPlaintext;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return toBase64(bytes);
}

export function base64ToBytes(encoded: string): Uint8Array {
  return fromBase64(encoded);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
