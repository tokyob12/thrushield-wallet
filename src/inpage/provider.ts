import { THRU_WALLET_CHANNEL, type BridgeEnvelope, type ThruSigningContext } from "../types/messages";

type ConnectedAccount = { publicKey: string };

const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();

let connectedAccounts: ConnectedAccount[] = [];

function createRequestId(): string {
  return crypto.randomUUID();
}

function sendRequest<T>(payload: Omit<BridgeEnvelope & { direction: "request" }, "channel" | "direction">["payload"]): Promise<T> {
  const requestId = payload.requestId;

  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    window.postMessage(
      {
        channel: THRU_WALLET_CHANNEL,
        direction: "request",
        payload,
      } satisfies BridgeEnvelope,
      window.location.origin,
    );
  });
}

function handleWindowMessage(event: MessageEvent<BridgeEnvelope>): void {
  if (event.source !== window || event.data?.channel !== THRU_WALLET_CHANNEL) {
    return;
  }

  if (event.data.direction !== "response") {
    return;
  }

  const { payload } = event.data;
  const pending = pendingRequests.get(payload.requestId);
  if (!pending) {
    return;
  }

  pendingRequests.delete(payload.requestId);

  if (payload.error) {
    pending.reject(new Error(payload.error.message));
    return;
  }

  pending.resolve(payload.result);
}

window.addEventListener("message", handleWindowMessage);

const thruWallet = {
  isConnected(): boolean {
    return connectedAccounts.length > 0;
  },

  async connect(): Promise<ConnectedAccount[]> {
    const result = (await sendRequest<ConnectedAccount[]>({
      type: "connect",
      requestId: createRequestId(),
      origin: window.location.origin,
    })) as ConnectedAccount[];

    connectedAccounts = result;
    window.dispatchEvent(new CustomEvent("thruWalletConnect", { detail: result }));
    return result;
  },

  async disconnect(): Promise<void> {
    await sendRequest<void>({
      type: "disconnect",
      requestId: createRequestId(),
      origin: window.location.origin,
    });

    connectedAccounts = [];
    window.dispatchEvent(new CustomEvent("thruWalletDisconnect"));
  },

  async getSigningContext(): Promise<ThruSigningContext> {
    if (!this.isConnected()) {
      throw new Error("Wallet not connected");
    }

    return sendRequest<ThruSigningContext>({
      type: "getSigningContext",
      requestId: createRequestId(),
      origin: window.location.origin,
    });
  },

  async signTransaction(serializedTransaction: string): Promise<string> {
    if (!this.isConnected()) {
      throw new Error("Wallet not connected");
    }

    if (typeof serializedTransaction !== "string" || serializedTransaction.length === 0) {
      throw new Error("Transaction payload must be a base64 encoded string");
    }

    return sendRequest<string>({
      type: "signTransaction",
      requestId: createRequestId(),
      origin: window.location.origin,
      payload: serializedTransaction,
    });
  },
};

Object.defineProperty(window, "thruWallet", {
  value: Object.freeze(thruWallet),
  writable: false,
  configurable: false,
});

export {};
