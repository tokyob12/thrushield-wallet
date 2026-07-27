import { THRU_WALLET_CHANNEL, type BridgeEnvelope, type DappRequestMessage, type DappResponseMessage } from "../types/messages";

const INPAGE_SCRIPT_ID = "thruShield-inpage-provider";

function injectInpageScript(): void {
  if (document.getElementById(INPAGE_SCRIPT_ID)) {
    return;
  }

  const script = document.createElement("script");
  script.id = INPAGE_SCRIPT_ID;
  script.src = chrome.runtime.getURL("src/inpage/provider.ts");
  script.type = "module";
  (document.head || document.documentElement).appendChild(script);
}

function relayToBackground(payload: DappRequestMessage): Promise<DappResponseMessage> {
  return chrome.runtime.sendMessage({
    source: "thruShield-content",
    kind: "dapp",
    payload,
  });
}

function handleWindowMessage(event: MessageEvent<BridgeEnvelope>): void {
  if (event.source !== window || event.data?.channel !== THRU_WALLET_CHANNEL) {
    return;
  }

  if (event.data.direction !== "request") {
    return;
  }

  const { payload } = event.data;

  relayToBackground({
    ...payload,
    origin: window.location.origin,
    ...(payload.type === "connect" || payload.type === "signTransaction"
      ? { faviconUrl: getFaviconUrl() }
      : {}),
  } as DappRequestMessage)
    .then((response) => {
      window.postMessage(
        {
          channel: THRU_WALLET_CHANNEL,
          direction: "response",
          payload: response,
        } satisfies BridgeEnvelope,
        window.location.origin,
      );
    })
    .catch((error) => {
      window.postMessage(
        {
          channel: THRU_WALLET_CHANNEL,
          direction: "response",
          payload: {
            requestId: payload.requestId,
            error: {
              code: "INTERNAL_ERROR",
              message: error instanceof Error ? error.message : "Bridge failure",
            },
          },
        } satisfies BridgeEnvelope,
        window.location.origin,
      );
    });
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

injectInpageScript();
window.addEventListener("message", handleWindowMessage);

export {};
