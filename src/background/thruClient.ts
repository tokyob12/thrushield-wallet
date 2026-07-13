import { createThruClient, type Thru } from "@thru/thru-sdk";

/**
 * Thru alphanet RPC (Connect/gRPC-Web).
 * Matches CLI default from docs / first-transaction guide.
 * Note: the older `grpc-web.alphanet.thruput.org` host no longer resolves.
 */
export const THRU_RPC_URL = "https://rpc.alphanet.thru.org";

/** EOA program pubkey (all zeros) — used for native balance transfers. */
export const EOA_PROGRAM = new Uint8Array(32);

/** Faucet program pubkey (last byte 0xFA). */
export const FAUCET_PROGRAM = (() => {
  const arr = new Uint8Array(32);
  arr[31] = 0xfa;
  return arr;
})();

/**
 * Genesis faucet account address (Thru format).
 * From rpc/cli faucet command: taxoImN8fTEOxXYnvgC6JZ0lN0n0qvZERwz_vlOjX3MkIn
 */
export const FAUCET_ACCOUNT_ADDRESS = "taxoImN8fTEOxXYnvgC6JZ0lN0n0qvZERwz_vlOjX3MkIn";

export const FAUCET_WITHDRAW_LIMIT = 10_000n;
export const NATIVE_TRANSFER_FEE = 1n;

let client: Thru | null = null;

export function getThruClient(): Thru {
  if (!client) {
    client = createThruClient({ baseUrl: THRU_RPC_URL });
  }
  return client;
}

export function encodeU16Le(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

export function encodeU32Le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

export function encodeU64Le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** EOA TRANSFER instruction: discriminant=1, amount, from_idx, to_idx */
export function buildEoaTransferInstruction(
  fromAccountIdx: number,
  toAccountIdx: number,
  amount: bigint,
): Uint8Array {
  return concatBytes(
    encodeU32Le(1),
    encodeU64Le(amount),
    encodeU16Le(fromAccountIdx),
    encodeU16Le(toAccountIdx),
  );
}

/** Faucet WITHDRAW instruction: discriminant=1, faucet_idx, recipient_idx, amount */
export function buildFaucetWithdrawInstruction(
  faucetAccountIdx: number,
  recipientAccountIdx: number,
  amount: bigint,
): Uint8Array {
  return concatBytes(
    encodeU32Le(1),
    encodeU16Le(faucetAccountIdx),
    encodeU16Le(recipientAccountIdx),
    encodeU64Le(amount),
  );
}
