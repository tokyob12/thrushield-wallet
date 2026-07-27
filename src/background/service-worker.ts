import {
  buildConnectApproval,
  buildSignApproval,
  clearApprovalWindow,
  clearDappJob,
  deliverDappResponse,
  getApprovalIdForWindow,
  getDappJob,
  getPendingApproval,
  openConfirmationWindow,
  saveDappJob,
} from "./approvalManager";
import { registerAutoLockHandler } from "./autoLock";
import {
  ensureOnChainAccount,
  faucetWithdraw,
  getAccountBalance,
  getTransactionHistory,
  transferNative,
} from "./chainActions";
import { buildSigningPayloadFromIntent, isTransactionIntent } from "./intentBuilder";
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
  SignTransactionInput,
  WalletState,
} from "../types/messages";

const CONTENT_SCRIPT_SOURCE = "thruShield-content";
const completingApprovals = new Set<string>();

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

async function finalizeConnect(origin: string, faviconUrl?: string): Promise<unknown> {
  const publicKey = getUnlockedPublicKey();
  if (!publicKey) {
    throw walletError("WALLET_LOCKED", "Wallet locked during connect");
  }

  await saveAuthorizedDApp({
    origin,
    publicKey,
    connectedAt: Date.now(),
    faviconUrl,
  });

  return [{ publicKey }];
}

async function resolveSignPayload(payload: SignTransactionInput): Promise<string> {
  if (typeof payload === "string") {
    if (!payload) {
      throw walletError("INVALID_PAYLOAD", "Transaction payload must be a base64 string");
    }
    return payload;
  }

  if (!isTransactionIntent(payload)) {
    throw walletError(
      "INVALID_PAYLOAD",
      "signTransaction expects base64 wire bytes or a transaction intent",
    );
  }

  const feePayer = getUnlockedPublicKey();
  if (!feePayer) {
    throw walletError("WALLET_LOCKED", "Wallet is locked");
  }

  try {
    return await buildSigningPayloadFromIntent(payload, feePayer);
  } catch (error) {
    throw walletError(
      "INVALID_PAYLOAD",
      error instanceof Error ? error.message : "Failed to build transaction intent",
    );
  }
}

/**
 * Start connect approval. Response is delivered later via completeApprovalJob.
 */
async function startConnect(
  message: Extract<DappRequestMessage, { type: "connect" }>,
  tabId: number,
): Promise<void> {
  if (!isValidOrigin(message.origin)) {
    throw walletError("UNAUTHORIZED_ORIGIN", "Invalid dApp origin");
  }

  if (!isWalletUnlocked()) {
    throw walletError("WALLET_LOCKED", "Unlock ThruShield before connecting");
  }

  const { id, approval } = buildConnectApproval(message.origin, message.faviconUrl);
  await saveDappJob({
    approval,
    requestId: message.requestId,
    tabId,
    message,
  });
  await openConfirmationWindow(id);
}

/**
 * Start sign approval. Response is delivered later via completeApprovalJob.
 */
async function startSignTransaction(
  message: Extract<DappRequestMessage, { type: "signTransaction" }>,
  tabId: number,
): Promise<void> {
  await assertAuthorizedOrigin(message.origin);

  if (!isWalletUnlocked()) {
    throw walletError("WALLET_LOCKED", "Wallet is locked");
  }

  const signingPayloadBase64 = await resolveSignPayload(message.payload);
  const { id, approval } = buildSignApproval(
    message.origin,
    signingPayloadBase64,
    message.faviconUrl,
  );

  await saveDappJob({
    approval,
    requestId: message.requestId,
    tabId,
    message,
    signingPayloadBase64,
  });
  await openConfirmationWindow(id);
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

/**
 * Returns a response for immediate methods, or null when approval UI will answer later.
 */
async function handleDappRequest(
  message: DappRequestMessage,
  tabId: number,
): Promise<DappResponseMessage | null> {
  try {
    switch (message.type) {
      case "connect":
        await startConnect(message, tabId);
        return null;

      case "signTransaction":
        await startSignTransaction(message, tabId);
        return null;

      case "disconnect":
        await handleDisconnect(message);
        return { requestId: message.requestId, result: undefined };

      case "getSigningContext":
        return {
          requestId: message.requestId,
          result: await handleGetSigningContext(message),
        };

      default:
        throw walletError("INTERNAL_ERROR", "Unknown request type");
    }
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

async function completeApprovalJob(
  approvalId: string,
  approved: boolean,
): Promise<InternalResponse<null>> {
  if (completingApprovals.has(approvalId)) {
    return { ok: true, data: null };
  }
  completingApprovals.add(approvalId);

  try {
    const job = await getDappJob(approvalId);
    if (!job) {
      return { ok: false, error: "Approval request not found or expired" };
    }

    // Clear first so window-close + button-approve cannot double-deliver.
    await clearDappJob(approvalId);

    let response: DappResponseMessage;

    try {
      if (!approved) {
        response = {
          requestId: job.requestId,
          error: walletError("USER_REJECTED", "Request rejected by user"),
        };
      } else if (job.message.type === "connect") {
        if (!isWalletUnlocked()) {
          response = {
            requestId: job.requestId,
            error: walletError("WALLET_LOCKED", "Unlock ThruShield before connecting"),
          };
        } else {
          response = {
            requestId: job.requestId,
            result: await finalizeConnect(job.message.origin, job.message.faviconUrl),
          };
        }
      } else if (job.message.type === "signTransaction") {
        if (!isWalletUnlocked()) {
          response = {
            requestId: job.requestId,
            error: walletError("WALLET_LOCKED", "Wallet is locked"),
          };
        } else {
          const payload = job.signingPayloadBase64;
          if (!payload) {
            response = {
              requestId: job.requestId,
              error: walletError("INVALID_PAYLOAD", "Missing signing payload"),
            };
          } else {
            response = {
              requestId: job.requestId,
              result: await signTransactionPayload(payload),
            };
          }
        }
      } else {
        response = {
          requestId: job.requestId,
          error: walletError("INTERNAL_ERROR", "Unsupported approval job"),
        };
      }
    } catch (error) {
      const err = error as {
        code?: NonNullable<DappResponseMessage["error"]>["code"];
        message?: string;
      };
      response = {
        requestId: job.requestId,
        error: {
          code: err.code ?? "INTERNAL_ERROR",
          message: err.message ?? "Unexpected error",
        },
      };
    }

    await deliverDappResponse(job.tabId, response);
    return { ok: true, data: null };
  } finally {
    completingApprovals.delete(approvalId);
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
        const approval = await getPendingApproval(message.approvalId);
        if (!approval) {
          return { ok: false, error: "Approval request not found or expired" };
        }
        return { ok: true, data: approval };
      }

      case "RESOLVE_APPROVAL":
        return completeApprovalJob(message.approvalId, message.approved);

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

      case "GET_TX_HISTORY":
        return { ok: true, data: await getTransactionHistory() };

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
  return sender.id === chrome.runtime.id && sender.tab?.id !== undefined;
}

registerAutoLockHandler(() => {
  lockWallet();
});

initializeVaultCache().catch(console.error);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source === CONTENT_SCRIPT_SOURCE && message?.kind === "dapp") {
    if (!isContentScriptSender(sender) || sender.tab?.id == null) {
      sendResponse({
        requestId: message.payload?.requestId,
        error: walletError("UNAUTHORIZED_ORIGIN", "Invalid message sender"),
      });
      return false;
    }

    const tabId = sender.tab.id;
    sendResponse({ accepted: true });

    void handleDappRequest(message.payload as DappRequestMessage, tabId).then((response) => {
      if (response) {
        return deliverDappResponse(tabId, response);
      }
      return undefined;
    });

    return false;
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

chrome.windows.onRemoved.addListener((windowId) => {
  void (async () => {
    const approvalId = await getApprovalIdForWindow(windowId);
    if (!approvalId) {
      return;
    }

    await clearApprovalWindow(windowId);

    // If the job is already cleared (user clicked Approve/Reject), this is a no-op.
    const job = await getDappJob(approvalId);
    if (!job) {
      return;
    }

    await completeApprovalJob(approvalId, false);
  })();
});

export {};
