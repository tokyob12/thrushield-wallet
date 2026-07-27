/**
 * Inpage provider — must stay self-contained (no imports).
 * Injected into the page world as a classic script via textContent.
 */

type ConnectedAccount = { publicKey: string };

type ThruSigningContext = {
  mode: "managed_fee_payer";
  selectedAccountPublicKey: string | null;
  feePayerPublicKey: string;
  signerPublicKey: string;
  acceptedInputEncodings: [
    "signing_payload_base64",
    "raw_transaction_base64",
    "transaction_intent",
  ];
  outputEncoding: "raw_transaction_base64";
};

type ThruTransactionIntent = {
  programAddress: string;
  instructionData: string;
  readWriteAddresses?: string[];
  readOnlyAddresses?: string[];
  walletAddress?: string;
  review?: {
    appName?: string;
    programAddress?: string;
    instruction?: string;
  };
};

type SignTransactionInput = string | ThruTransactionIntent;

type DappRequest =
  | { type: "connect"; requestId: string; origin: string }
  | { type: "disconnect"; requestId: string; origin: string }
  | { type: "getSigningContext"; requestId: string; origin: string }
  | {
      type: "signTransaction";
      requestId: string;
      origin: string;
      payload: SignTransactionInput;
    };

type DappResponse = {
  requestId: string;
  result?: unknown;
  error?: { code: string; message: string };
};

const THRU_WALLET_CHANNEL = "THRUSHIELD_WALLET_BRIDGE";

const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();

let connectedAccounts: ConnectedAccount[] = [];

function createRequestId(): string {
  return crypto.randomUUID();
}

function sendRequest<T>(payload: DappRequest): Promise<T> {
  const requestId = payload.requestId;

  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Wallet request timed out. Unlock ThruShield and try again."));
    }, 120_000);

    pendingRequests.set(requestId, {
      resolve: (value: unknown) => {
        window.clearTimeout(timeoutId);
        resolve(value as T);
      },
      reject: (reason: Error) => {
        window.clearTimeout(timeoutId);
        reject(reason);
      },
    });

    window.postMessage(
      {
        channel: THRU_WALLET_CHANNEL,
        direction: "request",
        payload,
      },
      window.location.origin,
    );
  });
}

function handleWindowMessage(event: MessageEvent): void {
  if (event.source !== window || event.data?.channel !== THRU_WALLET_CHANNEL) {
    return;
  }

  if (event.data.direction !== "response") {
    return;
  }

  const payload = event.data.payload as DappResponse;
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
    const result = await sendRequest<ConnectedAccount[]>({
      type: "connect",
      requestId: createRequestId(),
      origin: window.location.origin,
    });

    if (!Array.isArray(result)) {
      throw new Error("Invalid connect response from ThruShield");
    }

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

  async signTransaction(input: SignTransactionInput): Promise<string> {
    if (!this.isConnected()) {
      throw new Error("Wallet not connected");
    }

    if (typeof input === "string") {
      if (input.length === 0) {
        throw new Error("Transaction payload must be a base64 encoded string");
      }
    } else if (
      !input ||
      typeof input !== "object" ||
      typeof input.programAddress !== "string" ||
      typeof input.instructionData !== "string"
    ) {
      throw new Error(
        "signTransaction expects base64 wire bytes or a ThruTransactionIntent object",
      );
    }

    return sendRequest<string>({
      type: "signTransaction",
      requestId: createRequestId(),
      origin: window.location.origin,
      payload: input,
    });
  },
};

Object.defineProperty(window, "thruWallet", {
  value: Object.freeze(thruWallet),
  writable: false,
  configurable: false,
});

window.dispatchEvent(new Event("thruWallet#initialized"));
