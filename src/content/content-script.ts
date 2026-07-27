import {
  THRU_WALLET_CHANNEL,
  type BridgeEnvelope,
  type DappRequestMessage,
  type DappResponseMessage,
} from "../types/messages";

/**
 * Isolated-world bridge only.
 * window.thruWallet is injected separately via manifest content_scripts world:MAIN
 * so page CSP cannot block it.
 */

function postResponse(payload: DappResponseMessage): void {
  window.postMessage(
    {
      channel: THRU_WALLET_CHANNEL,
      direction: "response",
      payload,
    } satisfies BridgeEnvelope,
    window.location.origin,
  );
}

function relayToBackground(payload: DappRequestMessage): void {
  chrome.runtime.sendMessage(
    {
      source: "thruShield-content",
      kind: "dapp",
      payload,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
}

function handleWindowMessage(event: MessageEvent<BridgeEnvelope>): void {
  if (event.source !== window || event.data?.channel !== THRU_WALLET_CHANNEL) {
    return;
  }

  if (event.data.direction !== "request") {
    return;
  }

  const { payload } = event.data;

  try {
    relayToBackground({
      ...payload,
      origin: window.location.origin,
      ...(payload.type === "connect" || payload.type === "signTransaction"
        ? { faviconUrl: getFaviconUrl() }
        : {}),
    } as DappRequestMessage);
  } catch (error) {
    postResponse({
      requestId: payload.requestId,
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Bridge failure",
      },
    });
  }
}

function getFaviconUrl(): string | undefined {
  const link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
  if (!link?.href) {
    return undefined;
  }

  try {
    return new URL(link.href, window.location.href).href;
  } catch {
    return undefined;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.source !== "thruShield-background" || message?.kind !== "dapp-response") {
    return;
  }

  if (!message.payload?.requestId) {
    return;
  }

  postResponse(message.payload as DappResponseMessage);
});

window.addEventListener("message", handleWindowMessage);

export {};
