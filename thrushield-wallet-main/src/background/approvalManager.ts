import type { PendingApproval } from "../types/messages";
import { decodeTransactionPreview } from "./keyManager";

type ApprovalResolver = (approved: boolean) => void;

const pendingApprovals = new Map<
  string,
  { approval: PendingApproval; resolve: ApprovalResolver }
>();

export function createApproval(
  approval: PendingApproval extends infer P ? P extends { id: string } ? Omit<P, "id"> : never : never,
): { id: string; approval: PendingApproval } {
  const id = crypto.randomUUID();
  const fullApproval = { ...approval, id } as PendingApproval;
  return { id, approval: fullApproval };
}

export function waitForApproval(id: string, approval: PendingApproval): Promise<boolean> {
  return new Promise((resolve) => {
    pendingApprovals.set(id, { approval, resolve });
  });
}

export function getPendingApproval(id: string): PendingApproval | null {
  return pendingApprovals.get(id)?.approval ?? null;
}

export function resolveApproval(id: string, approved: boolean): boolean {
  const pending = pendingApprovals.get(id);
  if (!pending) {
    return false;
  }

  pending.resolve(approved);
  pendingApprovals.delete(id);
  return true;
}

export function buildConnectApproval(
  origin: string,
  faviconUrl?: string,
): { id: string; approval: PendingApproval } {
  return createApproval({ kind: "connect", origin, faviconUrl });
}

export function buildSignApproval(
  origin: string,
  payload: string,
  faviconUrl?: string,
): { id: string; approval: PendingApproval } {
  let decoded;
  try {
    decoded = decodeTransactionPreview(payload);
  } catch (error) {
    throw Object.assign(new Error("Invalid transaction payload"), {
      code: "INVALID_PAYLOAD" as const,
      cause: error,
    });
  }

  return createApproval({
    kind: "signTransaction",
    origin,
    faviconUrl,
    payload,
    decoded,
  });
}

export async function openConfirmationWindow(approvalId: string): Promise<void> {
  const url = chrome.runtime.getURL(`src/popup/confirm/index.html?id=${approvalId}`);
  await chrome.windows.create({
    type: "popup",
    url,
    width: 420,
    height: 640,
    focused: true,
  });
}
