import {
  buildConnectApproval,
  buildSignApproval,
  getPendingApproval,
  openConfirmationWindow,
  resolveApproval,
  waitForApproval,
} from "./approvalManager";
import { registerAutoLockHandler } from "./autoLock";
import {
  ensureOnChainAccount,
  faucetWithdraw,
  getAccountBalance,
  transferNative,
} from "./chainActions";
import {
  addAccount,
  createWallet,
  exportPrivateKey,
  getSigningContextForWallet,
  getUnlockedPublicKey,
  getWalletAccounts,
  importWallet,
  importWalletFromPrivateKey,
  initializeVaultCache,
  isWalletInitialized,
  isWalletUnlocked,
  lockWallet,
  signTransactionPayload,
  switchAccount,
  unlockWallet,
} from "./keyManager";
import { assertAuthorizedOrigin, isValidOrigin } from "./originValidator";
import {
  getAuthorizedDApps,
  removeAuthorizedDApp,
  saveAuthorizedDApp,
} from "./storage";
import type {
  DappRequestMessage,
  DappResponseMessage,
  InternalMessage,
  InternalResponse,
  WalletState,
} from "../types/messages";

const CONTENT_SCRIPT_SOURCE = "thruShield-content";

function walletError(
  code: NonNullable<DappResponseMessage["error"]>["code"],
  message: string,
) {
  return { code, message };
}

function getWalletState(): WalletState {
  const accounts = isWalletUnlocked() ? getWalletAccounts() : [];
  const active = accounts.find((account) => account.isActive) ?? null;

  return {
    isInitialized: isWalletInitialized(),
    isUnlocked: isWalletUnlocked(),
    publicKey: getUnlockedPublicKey(),
    address: getUnlockedPublicKey(),
    autoLockMs: 15 * 60 * 1000,
    accounts,
    activeAccountId: active?.id ?? null,
  };
}

async function requestUserApproval(
  approvalBuilder: () => { id: string; approval: Parameters<typeof waitForApproval>[1] },
): Promise<boolean> {
  const { id, approval } = approvalBuilder();
  const approvalPromise = waitForApproval(id, approval);
  await openConfirmationWindow(id);
  return approvalPromise;
}

async function handleConnect(
  message: Extract<DappRequestMessage, { type: "connect" }>,
): Promise<unknown> {
  if (!isValidOrigin(message.origin)) {
    throw walletError("UNAUTHORIZED_ORIGIN", "Invalid dApp origin");
  }

  if (!isWalletUnlocked()) {
    throw walletError("WALLET_LOCKED", "Unlock ThruShield before connecting");
  }

  const approved = await requestUserApproval(() =>
    buildConnectApproval(message.origin, message.faviconUrl),
  );

  if (!approved) {
    throw walletError("USER_REJECTED", "Connection rejected by user");
  }

  const publicKey = getUnlockedPublicKey();
  if (!publicKey) {
    throw walletError("WALLET_LOCKED", "Wallet locked during connect");
  }

  await saveAuthorizedDApp({
    origin: message.origin,
    publicKey,
    connectedAt: Date.now(),
    faviconUrl: message.faviconUrl,
  });

  return [{ publicKey }];
}

async function handleDisconnect(
  message: Extract<DappRequestMessage, { type: "disconnect" }>,
): Promise<void> {
  await assertAuthorizedOrigin(message.origin);
  await removeAuthorizedDApp(message.origin);
}

async function handleGetSigningContext(
  message: Extract<DappRequestMessage, { type: "getSigningContext" }>,
): Promise<unknown> {
  await assertAuthorizedOrigin(message.origin);

  if (!isWalletUnlocked()) {
    throw walletError("WALLET_LOCKED", "Wallet is locked");
  }

  return getSigningContextForWallet();
}

async function handleSignTransaction(
  message: Extract<DappRequestMessage, { type: "signTransaction" }>,
): Promise<string> {
  await assertAuthorizedOrigin(message.origin);

  if (!message.payload || typeof message.payload !== "string") {
    throw walletError("INVALID_PAYLOAD", "Transaction payload must be a base64 string");
  }

  if (!isWalletUnlocked()) {
    throw walletError("WALLET_LOCKED", "Wallet is locked");
  }

  const approved = await requestUserApproval(() =>
    buildSignApproval(message.origin, message.payload, message.faviconUrl),
  );

  if (!approved) {
    throw walletError("USER_REJECTED", "Transaction signing rejected by user");
  }

  return signTransactionPayload(message.payload);
}

async function handleDappRequest(message: DappRequestMessage): Promise<DappResponseMessage> {
  try {
    let result: unknown;

    switch (message.type) {
      case "connect":
        result = await handleConnect(message);
        break;
      case "disconnect":
        await handleDisconnect(message);
        result = undefined;
        break;
      case "getSigningContext":
        result = await handleGetSigningContext(message);
        break;
      case "signTransaction":
        result = await handleSignTransaction(message);
        break;
      default:
        throw walletError("INTERNAL_ERROR", "Unknown request type");
    }

    return { requestId: message.requestId, result };
  } catch (error) {
    const err = error as {
      code?: NonNullable<DappResponseMessage["error"]>["code"];
      message?: string;
    };
    return {
      requestId: message.requestId,
      error: {
        code: err.code ?? "INTERNAL_ERROR",
        message: err.message ?? "Unexpected error",
      },
    };
  }
}

function parseAmount(raw: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Amount must be a positive integer");
  }
  return BigInt(trimmed);
}

async function handleInternalMessage(
  message: InternalMessage,
): Promise<InternalResponse<unknown>> {
  try {
    switch (message.type) {
      case "GET_WALLET_STATE":
        return { ok: true, data: getWalletState() };

      case "UNLOCK_WALLET": {
        const { address } = await unlockWallet(message.password);
        return { ok: true, data: { address } };
      }

      case "CREATE_WALLET": {
        const result = await createWallet(message.password, message.mnemonic);
        return { ok: true, data: result };
      }

      case "IMPORT_WALLET": {
        const result = await importWallet(message.password, message.mnemonic);
        return { ok: true, data: result };
      }

      case "IMPORT_WALLET_PRIVATE_KEY": {
        const result = await importWalletFromPrivateKey(
          message.password,
          message.privateKey,
          message.name,
        );
        return { ok: true, data: result };
      }

      case "LOCK_WALLET":
        lockWallet();
        return { ok: true, data: null };

      case "GET_AUTHORIZED_DAPPS":
        return { ok: true, data: await getAuthorizedDApps() };

      case "REVOKE_DAPP":
        await removeAuthorizedDApp(message.origin);
        return { ok: true, data: null };

      case "GET_PENDING_APPROVAL": {
        const approval = getPendingApproval(message.approvalId);
        if (!approval) {
          return { ok: false, error: "Approval request not found or expired" };
        }
        return { ok: true, data: approval };
      }

      case "RESOLVE_APPROVAL": {
        const resolved = resolveApproval(message.approvalId, message.approved);
        if (!resolved) {
          return { ok: false, error: "Approval request not found or expired" };
        }
        return { ok: true, data: null };
      }

      case "GET_BALANCE":
        return { ok: true, data: await getAccountBalance() };

      case "ENSURE_ONCHAIN_ACCOUNT":
        return { ok: true, data: await ensureOnChainAccount() };

      case "FAUCET_WITHDRAW": {
        const amount = parseAmount(message.amount);
        return { ok: true, data: await faucetWithdraw(amount) };
      }

      case "TRANSFER_NATIVE": {
        const amount = parseAmount(message.amount);
        return {
          ok: true,
          data: await transferNative(message.destination.trim(), amount),
        };
      }

      case "LIST_ACCOUNTS":
        return { ok: true, data: getWalletAccounts() };

      case "ADD_ACCOUNT": {
        const result = await addAccount(message.password, message.name);
        return { ok: true, data: result };
      }

      case "SWITCH_ACCOUNT": {
        const result = await switchAccount(message.accountId);
        return { ok: true, data: result };
      }

      case "EXPORT_PRIVATE_KEY": {
        const result = await exportPrivateKey(message.password);
        return { ok: true, data: result };
      }

      default:
        return { ok: false, error: "Unknown internal message" };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    };
  }
}

function isContentScriptSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.tab !== undefined;
}

registerAutoLockHandler(() => {
  lockWallet();
});

initializeVaultCache().catch(console.error);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source === CONTENT_SCRIPT_SOURCE && message?.kind === "dapp") {
    if (!isContentScriptSender(sender)) {
      sendResponse({
        requestId: message.payload?.requestId,
        error: walletError("UNAUTHORIZED_ORIGIN", "Invalid message sender"),
      });
      return false;
    }

    handleDappRequest(message.payload as DappRequestMessage)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          requestId: (message.payload as DappRequestMessage).requestId,
          error: walletError(
            "INTERNAL_ERROR",
            error instanceof Error ? error.message : "Unexpected error",
          ),
        });
      });

    return true;
  }

  if (message?.source === "thruShield-internal") {
    handleInternalMessage(message.payload as InternalMessage)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unexpected error",
        });
      });
    return true;
  }

  return false;
});

export {};
