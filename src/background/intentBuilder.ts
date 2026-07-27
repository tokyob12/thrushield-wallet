import { Pubkey } from "@thru/sdk";
import { base64ToBytes, bytesToBase64 } from "../utils/crypto";
import { getThruClient } from "./thruClient";
import type { ThruTransactionIntent } from "../types/messages";

function decodeInstructionData(value: string): Uint8Array {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("instructionData is required");
  }

  // Prefer base64 (official wallet contract). Fall back to hex for convenience.
  try {
    return base64ToBytes(trimmed);
  } catch {
    const hex = trimmed.replace(/^0x/i, "");
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
      throw new Error("instructionData must be base64 or hex");
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
  }
}

/**
 * Build an unsigned signing payload from a ThruTransactionIntent.
 * Matches the official hosted-wallet contract: wallet owns fee payer / wire layout.
 */
export async function buildSigningPayloadFromIntent(
  intent: ThruTransactionIntent,
  feePayerAddress: string,
): Promise<string> {
  if (!intent.programAddress || typeof intent.programAddress !== "string") {
    throw new Error("programAddress is required");
  }
  if (!intent.instructionData || typeof intent.instructionData !== "string") {
    throw new Error("instructionData is required");
  }

  const thru = getThruClient();
  const instructionData = decodeInstructionData(intent.instructionData);

  const readWrite = (intent.readWriteAddresses ?? []).map((address) => Pubkey.from(address));
  const readOnly = (intent.readOnlyAddresses ?? []).map((address) => Pubkey.from(address));

  const tx = await thru.transactions.build({
    feePayer: { publicKey: feePayerAddress },
    program: intent.programAddress,
    accounts: {
      readWrite,
      readOnly,
    },
    instructionData,
  });

  return bytesToBase64(tx.toWire());
}

export function isTransactionIntent(value: unknown): value is ThruTransactionIntent {
  return (
    typeof value === "object" &&
    value !== null &&
    "programAddress" in value &&
    "instructionData" in value
  );
}
