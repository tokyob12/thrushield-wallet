import { Pubkey, Signature, AccountView, type Transaction } from "@thru/thru-sdk";
import { getUnlockedKeyMaterial, type UnlockedKeyMaterial } from "./keyManager";
import { resetAutoLockTimer } from "./autoLock";
import {
  buildEoaTransferInstruction,
  buildFaucetWithdrawInstruction,
  EOA_PROGRAM,
  FAUCET_ACCOUNT_ADDRESS,
  FAUCET_PROGRAM,
  FAUCET_WITHDRAW_LIMIT,
  getThruClient,
  NATIVE_TRANSFER_FEE,
} from "./thruClient";

export type AccountBalanceInfo = {
  address: string;
  exists: boolean;
  balance: string;
  nonce: string;
};

export type ChainTxResult = {
  signature: string;
  amount: string;
};

export type TransactionHistoryEntry = {
  signature: string;
  feePayer: string;
  program: string;
  slot: string;
  timestamp: string;
  fee: string;
  isIncoming: boolean;
  executionSuccess: boolean;
  vmError: string;
};

function requireUnlocked(): UnlockedKeyMaterial {
  const keys = getUnlockedKeyMaterial();
  if (!keys) {
    throw new Error("Wallet is locked");
  }
  return keys;
}

function wrapNetworkError(error: unknown, action: string): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed|dns/i.test(message)) {
    throw new Error(
      `${action} failed: cannot reach Thru RPC (https://rpc.alphanet.thru.org). Check your network and that the extension was reloaded after updating host permissions. Details: ${message}`,
    );
  }
  throw error instanceof Error ? error : new Error(String(error));
}

function toSignatureString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Signature.from(value).toThruFmt();
  }
  if (value && typeof value === "object" && "toThruFmt" in value) {
    return (value as Signature).toThruFmt();
  }
  return String(value);
}

export async function getAccountBalance(address?: string): Promise<AccountBalanceInfo> {
  const keys = requireUnlocked();
  await resetAutoLockTimer();

  const target = address ?? keys.address;
  const thru = getThruClient();

  try {
    const account = await thru.accounts.get(target, { view: AccountView.META_ONLY });
    return {
      address: target,
      exists: true,
      balance: (account.meta?.balance ?? 0n).toString(),
      nonce: (account.meta?.nonce ?? 0n).toString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Missing accounts surface as RPC/not-found errors; network failures should bubble.
    if (/failed to fetch|networkerror|load failed|dns/i.test(message)) {
      wrapNetworkError(error, "Balance lookup");
    }
    return {
      address: target,
      exists: false,
      balance: "0",
      nonce: "0",
    };
  }
}

/**
 * Ensure the unlocked wallet account exists on-chain (thru account create).
 * Required before faucet withdraw when the account is brand new.
 */
export async function ensureOnChainAccount(): Promise<{ created: boolean; signature?: string }> {
  const keys = requireUnlocked();
  await resetAutoLockTimer();

  const existing = await getAccountBalance(keys.address);
  if (existing.exists) {
    return { created: false };
  }

  const thru = getThruClient();
  const unsigned = await thru.accounts.create({ publicKey: keys.address });
  await unsigned.sign(keys.privateKey);
  const signature = await thru.transactions.send(unsigned.toWire());

  return { created: true, signature: toSignatureString(signature) };
}

/**
 * Withdraw native Thru from the faucet program into the unlocked wallet.
 * Mirrors: `thru faucet withdraw <account> <amount>`
 * Cap: 10000 per transaction (CLI / TN_FAUCET_WITHDRAW_LIMIT).
 */
export async function faucetWithdraw(amount: bigint): Promise<ChainTxResult> {
  const keys = requireUnlocked();
  await resetAutoLockTimer();

  if (amount <= 0n) {
    throw new Error("Withdraw amount must be greater than 0");
  }
  if (amount > FAUCET_WITHDRAW_LIMIT) {
    throw new Error(`Withdraw amount exceeds limit of ${FAUCET_WITHDRAW_LIMIT}`);
  }

  try {
    // Match first-transaction guide: create account, then faucet withdraw.
    await ensureOnChainAccount();

    const thru = getThruClient();
    const account = await thru.accounts.get(keys.address, { view: AccountView.META_ONLY });
    const nonce = account.meta?.nonce ?? 0n;
    const height = await thru.blocks.getBlockHeight();

    const faucetAccount = Pubkey.from(FAUCET_ACCOUNT_ADDRESS);

    const { rawTransaction, signature } = await thru.transactions.buildAndSign({
      feePayer: {
        publicKey: keys.address,
        privateKey: keys.privateKey,
      },
      program: FAUCET_PROGRAM,
      header: {
        fee: 0n,
        nonce,
        startSlot: height.finalized,
        expiryAfter: 100,
        computeUnits: 300_000,
        stateUnits: 10_000,
        memoryUnits: 10_000,
      },
      accounts: {
        // Recipient is fee payer (idx 0). Faucet account is the only RW peer (idx 2).
        readWrite: [faucetAccount],
        readOnly: [],
      },
      instructionData: buildFaucetWithdrawInstruction(2, 0, amount),
    });

    await thru.transactions.send(rawTransaction);

    return {
      signature: toSignatureString(signature),
      amount: amount.toString(),
    };
  } catch (error) {
    wrapNetworkError(error, "Faucet withdraw");
  }
}

/**
 * Native balance transfer via EOA program.
 * Mirrors: `thru transfer <src> <dst> <value>`
 */
/**
 * Fetch recent transactions for the active account.
 */
export async function getTransactionHistory(): Promise<TransactionHistoryEntry[]> {
  const keys = requireUnlocked();
  await resetAutoLockTimer();

  const thru = getThruClient();

  try {
    const result = await thru.transactions.listForAccount(keys.address);
    const entries: TransactionHistoryEntry[] = [];

    const txList = [...result.transactions];
    txList.reverse();

    for (const tx of txList) {
      const sig = tx.getSignature();
      const feePayerKey = Pubkey.from(tx.feePayer);
      const programKey = Pubkey.from(tx.program);

      const slotNum = tx.slot ?? 0n;

      // Fetch the actual on-chain status to get the real block timestamp
      let timestamp = "";
      try {
        if (sig) {
          const status = await thru.transactions.getStatus(sig);
          // blockTimestampNs exists at runtime (from proto) but is not in the TS type
          const tsNs = (status as unknown as Record<string, unknown>)["blockTimestampNs"];
          if (typeof tsNs === "bigint" && tsNs > 0n) {
            // blockTimestampNs is in nanoseconds — convert to milliseconds
            timestamp = new Date(Number(tsNs / 1_000_000n)).toISOString();
          }
        }
      } catch {
        // Status unavailable — fall through to empty timestamp
      }

      entries.push({
        signature: sig ? toSignatureString(sig) : "",
        feePayer: feePayerKey.toThruFmt(),
        program: programKey.toThruFmt(),
        slot: slotNum.toString(),
        timestamp,
        fee: tx.fee.toString(),
        isIncoming: feePayerKey.toThruFmt() !== keys.address,
        executionSuccess: tx.executionResult
          ? tx.executionResult.executionResult === 0n
          : true,
        vmError: tx.executionResult
          ? String(tx.executionResult.vmError)
          : "",
      });
    }

    return entries;
  } catch (error) {
    wrapNetworkError(error, "Transaction history");
  }
}

export async function transferNative(
  destination: string,
  amount: bigint,
): Promise<ChainTxResult> {
  const keys = requireUnlocked();
  await resetAutoLockTimer();

  if (amount <= 0n) {
    throw new Error("Transfer amount must be greater than 0");
  }

  let destinationPubkey: Pubkey;
  try {
    destinationPubkey = Pubkey.from(destination);
  } catch {
    throw new Error("Invalid destination address (expected ta… format)");
  }

  if (destinationPubkey.toThruFmt() === keys.address) {
    throw new Error("Cannot transfer to the same account");
  }

  const thru = getThruClient();
  const account = await thru.accounts.get(keys.address, { view: AccountView.META_ONLY });
  const balance = account.meta?.balance ?? 0n;
  const nonce = account.meta?.nonce ?? 0n;
  const totalRequired = amount + NATIVE_TRANSFER_FEE;

  if (balance < totalRequired) {
    throw new Error(
      `Insufficient balance. Required: ${totalRequired} (transfer ${amount} + fee ${NATIVE_TRANSFER_FEE}), available: ${balance}`,
    );
  }

  const height = await thru.blocks.getBlockHeight();

  const { rawTransaction, signature } = await thru.transactions.buildAndSign({
    feePayer: {
      publicKey: keys.address,
      privateKey: keys.privateKey,
    },
    program: EOA_PROGRAM,
    header: {
      fee: NATIVE_TRANSFER_FEE,
      nonce,
      startSlot: height.finalized,
      expiryAfter: 100,
      computeUnits: 10_000,
      stateUnits: 10_000,
      memoryUnits: 10_000,
    },
    accounts: {
      readWrite: [destinationPubkey],
      readOnly: [],
    },
    // Account layout: [0 fee_payer/from, 1 program, 2 destination]
    instructionData: buildEoaTransferInstruction(0, 2, amount),
  });

  await thru.transactions.send(rawTransaction);

  return {
    signature: toSignatureString(signature),
    amount: amount.toString(),
  };
}
