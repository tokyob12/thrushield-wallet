/** Shared IPC message types — no secrets or key material in these payloads. */

export const THRU_WALLET_CHANNEL = "THRUSHIELD_WALLET_BRIDGE" as const;

export type ThruSigningContext = {
  mode: "managed_fee_payer";
  selectedAccountPublicKey: string | null;
  feePayerPublicKey: string;
  signerPublicKey: string;
  acceptedInputEncodings: ["signing_payload_base64", "raw_transaction_base64"];
  outputEncoding: "raw_transaction_base64";
};

export type WalletErrorCode =
  | "UNAUTHORIZED_ORIGIN"
  | "WALLET_LOCKED"
  | "USER_REJECTED"
  | "INVALID_PAYLOAD"
  | "NOT_CONNECTED"
  | "INTERNAL_ERROR";

export interface WalletError {
  code: WalletErrorCode;
  message: string;
}

/** Messages relayed from inpage → content → background */
export type DappRequestMessage =
  | { type: "connect"; requestId: string; origin: string; faviconUrl?: string }
  | { type: "disconnect"; requestId: string; origin: string }
  | { type: "getSigningContext"; requestId: string; origin: string }
  | {
      type: "signTransaction";
      requestId: string;
      origin: string;
      payload: string;
      faviconUrl?: string;
    };

export type DappResponseMessage = {
  requestId: string;
  result?: unknown;
  error?: WalletError;
};

/** Background ↔ popup / confirm UI */
export type InternalMessage =
  | { type: "GET_WALLET_STATE" }
  | { type: "UNLOCK_WALLET"; password: string }
  | { type: "CREATE_WALLET"; password: string; mnemonic?: string }
  | { type: "IMPORT_WALLET"; password: string; mnemonic: string }
  | { type: "IMPORT_WALLET_PRIVATE_KEY"; password: string; privateKey: string; name?: string }
  | { type: "LOCK_WALLET" }
  | { type: "GET_AUTHORIZED_DAPPS" }
  | { type: "REVOKE_DAPP"; origin: string }
  | { type: "GET_PENDING_APPROVAL"; approvalId: string }
  | { type: "RESOLVE_APPROVAL"; approvalId: string; approved: boolean }
  | { type: "GET_BALANCE" }
  | { type: "FAUCET_WITHDRAW"; amount: string }
  | { type: "TRANSFER_NATIVE"; destination: string; amount: string }
  | { type: "ENSURE_ONCHAIN_ACCOUNT" }
  | { type: "LIST_ACCOUNTS" }
  | { type: "ADD_ACCOUNT"; password: string; name?: string }
  | { type: "SWITCH_ACCOUNT"; accountId: string }
  | { type: "EXPORT_PRIVATE_KEY"; password: string };

export type WalletAccountSummary = {
  id: string;
  name: string;
  address: string;
  accountIndex: number;
  isActive: boolean;
};

export type WalletState = {
  isInitialized: boolean;
  isUnlocked: boolean;
  publicKey: string | null;
  address: string | null;
  autoLockMs: number;
  accounts: WalletAccountSummary[];
  activeAccountId: string | null;
};

export type ExportedPrivateKey = {
  address: string;
  accountName: string;
  privateKeyHex: string;
};

export type BalanceInfo = {
  address: string;
  exists: boolean;
  balance: string;
  nonce: string;
};

export type ChainActionResult = {
  signature: string;
  amount: string;
};

export type AuthorizedDApp = {
  origin: string;
  publicKey: string;
  connectedAt: number;
  faviconUrl?: string;
};

export type PendingApproval =
  | {
      id: string;
      kind: "connect";
      origin: string;
      faviconUrl?: string;
    }
  | {
      id: string;
      kind: "signTransaction";
      origin: string;
      faviconUrl?: string;
      payload: string;
      decoded: DecodedTransactionPreview;
    };

export type DecodedTransactionPreview = {
  feePayer: string;
  program: string;
  gasLimit: number;
  stateUnits: number;
  memoryUnits: number;
  chainId: number;
  instructionDataHex: string;
  instructionDataSize: number;
  readWriteAccounts: string[];
  readOnlyAccounts: string[];
};

export type InternalResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Bridge envelope between inpage and content script */
export type BridgeEnvelope =
  | { channel: typeof THRU_WALLET_CHANNEL; direction: "request"; payload: DappRequestMessage }
  | { channel: typeof THRU_WALLET_CHANNEL; direction: "response"; payload: DappResponseMessage };
