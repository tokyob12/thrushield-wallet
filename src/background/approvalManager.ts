import type { DappRequestMessage, DappResponseMessage, PendingApproval } from "../types/messages";
import { decodeTransactionPreview } from "./keyManager";

const JOB_PREFIX = "thruShield:dappJob:";
const WINDOW_PREFIX = "thruShield:approvalWindow:";

export type PendingDappJob = {
  approval: PendingApproval;
  requestId: string;
  tabId: number;
  message: DappRequestMessage;
  /** Pre-built wire payload for intent-based sign requests. */
  signingPayloadBase64?: string;
};

function jobKey(approvalId: string): string {
  return `${JOB_PREFIX}${approvalId}`;
}

function windowKey(windowId: number): string {
  return `${WINDOW_PREFIX}${windowId}`;
}

export function createApproval(
  approval: PendingApproval extends infer P
    ? P extends { id: string }
      ? Omit<P, "id">
      : never
    : never,
): { id: string; approval: PendingApproval } {
  const id = crypto.randomUUID();
  const fullApproval = { ...approval, id } as PendingApproval;
  return { id, approval: fullApproval };
}

export async function saveDappJob(job: PendingDappJob): Promise<void> {
  await chrome.storage.session.set({ [jobKey(job.approval.id)]: job });
}

export async function getDappJob(approvalId: string): Promise<PendingDappJob | null> {
  const stored = await chrome.storage.session.get(jobKey(approvalId));
  return (stored[jobKey(approvalId)] as PendingDappJob | undefined) ?? null;
}

export async function clearDappJob(approvalId: string): Promise<void> {
  await chrome.storage.session.remove(jobKey(approvalId));
}

export async function getPendingApproval(id: string): Promise<PendingApproval | null> {
  const job = await getDappJob(id);
  return job?.approval ?? null;
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

export async function openConfirmationWindow(approvalId: string): Promise<number> {
  const url = chrome.runtime.getURL(`src/popup/confirm/index.html?id=${approvalId}`);
  const win = await chrome.windows.create({
    type: "popup",
    url,
    width: 420,
    height: 640,
    focused: true,
  });

  const windowId = win?.id;
  if (windowId == null) {
    throw new Error("Failed to open approval window");
  }

  await chrome.storage.session.set({ [windowKey(windowId)]: approvalId });
  return windowId;
}

export async function getApprovalIdForWindow(windowId: number): Promise<string | null> {
  const stored = await chrome.storage.session.get(windowKey(windowId));
  return (stored[windowKey(windowId)] as string | undefined) ?? null;
}

export async function clearApprovalWindow(windowId: number): Promise<void> {
  await chrome.storage.session.remove(windowKey(windowId));
}

export async function deliverDappResponse(
  tabId: number,
  payload: DappResponseMessage,
): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      source: "thruShield-background",
      kind: "dapp-response",
      payload,
    });
  } catch (error) {
    console.warn("ThruShield: failed to deliver dApp response to tab", tabId, error);
  }
}
