import { useCallback, useEffect, useState } from "react";
import type {
  AuthorizedDApp,
  BalanceInfo,
  ChainActionResult,
  ExportedPrivateKey,
  InternalMessage,
  InternalResponse,
  WalletAccountSummary,
  WalletState,
} from "../types/messages";

async function sendInternal<T>(payload: InternalMessage): Promise<InternalResponse<T>> {
  return chrome.runtime.sendMessage({
    source: "thruShield-internal",
    payload,
  });
}

type View = "dashboard" | "create" | "import" | "unlock" | "settings";

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [state, setState] = useState<WalletState | null>(null);
  const [dapps, setDapps] = useState<AuthorizedDApp[]>([]);
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [password, setPassword] = useState("");
  const [settingsPassword, setSettingsPassword] = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string | null>(null);
  const [exportedKey, setExportedKey] = useState<ExportedPrivateKey | null>(null);
  const [showExportForm, setShowExportForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [faucetAmount, setFaucetAmount] = useState("10000");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("100");
  const [isSendOpen, setIsSendOpen] = useState(false);

  const activeAccount = state?.accounts.find((account) => account.isActive) ?? null;
  const activeAddress = state?.address ?? "";

  const shortAddress = activeAddress
    ? `${activeAddress.slice(0, 8)}...${activeAddress.slice(-8)}`
    : null;

  const refreshBalance = useCallback(async () => {
    const response = await sendInternal<BalanceInfo>({ type: "GET_BALANCE" });
    if (response.ok) {
      setBalance(response.data);
    }
  }, []);

  const refresh = useCallback(async () => {
    const walletState = await sendInternal<WalletState>({ type: "GET_WALLET_STATE" });
    if (walletState.ok) {
      setState(walletState.data);
      if (!walletState.data.isInitialized) {
        setView("create");
      } else if (!walletState.data.isUnlocked) {
        setView("unlock");
      } else if (view !== "settings") {
        setView("dashboard");
        await refreshBalance();
      } else {
        await refreshBalance();
      }
    }

    const authorized = await sendInternal<AuthorizedDApp[]>({ type: "GET_AUTHORIZED_DAPPS" });
    if (authorized.ok) {
      setDapps(authorized.data);
    }
  }, [refreshBalance, view]);

  useEffect(() => {
    refresh().catch(console.error);
    // Only on mount — avoid refresh loop from view dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateWallet(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await sendInternal<{ mnemonic: string; address: string }>({
      type: "CREATE_WALLET",
      password,
    });

    if (!response.ok) {
      setError(response.error);
      setBusy(false);
      return;
    }

    setGeneratedMnemonic(response.data.mnemonic);
    setPassword("");
    setMnemonic("");
    await refresh();
    setView("dashboard");
    setBusy(false);
  }

  async function handleImportWallet(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await sendInternal<{ address: string }>({
      type: "IMPORT_WALLET",
      password,
      mnemonic: mnemonic.trim(),
    });

    if (!response.ok) {
      setError(response.error);
      setBusy(false);
      return;
    }

    setPassword("");
    setMnemonic("");
    await refresh();
    setView("dashboard");
    setBusy(false);
  }

  async function handleUnlock(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await sendInternal<{ address: string }>({
      type: "UNLOCK_WALLET",
      password,
    });

    if (!response.ok) {
      setError(response.error);
      setBusy(false);
      return;
    }

    setPassword("");
    await refresh();
    setView("dashboard");
    setBusy(false);
  }

  async function handleLock() {
    await sendInternal({ type: "LOCK_WALLET" });
    setBalance(null);
    setSuccess(null);
    setExportedKey(null);
    setShowExportForm(false);
    setSettingsPassword("");
    setView("unlock");
    await refresh();
  }

  async function handleRevoke(origin: string) {
    await sendInternal({ type: "REVOKE_DAPP", origin });
    await refresh();
  }

  async function handleFaucet(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    const response = await sendInternal<ChainActionResult>({
      type: "FAUCET_WITHDRAW",
      amount: faucetAmount,
    });

    if (!response.ok) {
      setError(response.error);
      setBusy(false);
      return;
    }

    setSuccess(`Faucet withdrew ${response.data.amount} THRU. Sig: ${response.data.signature}`);
    await refreshBalance();
    setBusy(false);
  }

  async function handleTransfer(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    const response = await sendInternal<ChainActionResult>({
      type: "TRANSFER_NATIVE",
      destination: transferTo,
      amount: transferAmount,
    });

    if (!response.ok) {
      setError(response.error);
      setBusy(false);
      return;
    }

    setSuccess(`Transferred ${response.data.amount} THRU. Sig: ${response.data.signature}`);
    setTransferTo("");
    setTransferAmount("100");
    setIsSendOpen(false);
    await refreshBalance();
    setBusy(false);
  }

  async function handleAddAccount(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    const response = await sendInternal<{ account: WalletAccountSummary }>({
      type: "ADD_ACCOUNT",
      password: settingsPassword,
      name: newAccountName || undefined,
    });

    if (!response.ok) {
      setError(response.error);
      setBusy(false);
      return;
    }

    setSuccess(`Created ${response.data.account.name}`);
    setSettingsPassword("");
    setNewAccountName("");
    setExportedKey(null);
    await refresh();
    setBusy(false);
  }

  async function handleSwitchAccount(accountId: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    setExportedKey(null);

    const response = await sendInternal<{ address: string }>({
      type: "SWITCH_ACCOUNT",
      accountId,
    });

    if (!response.ok) {
      setError(response.error);
      setBusy(false);
      return;
    }

    setSuccess("Switched account");
    await refresh();
    setBusy(false);
  }

  async function handleExportKey(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    setExportedKey(null);

    const response = await sendInternal<ExportedPrivateKey>({
      type: "EXPORT_PRIVATE_KEY",
      password: settingsPassword,
    });

    if (!response.ok) {
      setError(response.error);
      setBusy(false);
      return;
    }

    setExportedKey(response.data);
    setSettingsPassword("");
    setBusy(false);
  }

  function openSettings() {
    setError(null);
    setSuccess(null);
    setExportedKey(null);
    setShowExportForm(false);
    setSettingsPassword("");
    setView("settings");
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setError(null);
      setSuccess(`${label} copied to clipboard`);
    } catch {
      setSuccess(null);
      setError(`Could not copy ${label.toLowerCase()}`);
    }
  }

  async function handleReceive() {
    if (!state?.address) {
      return;
    }

    await copyText(state.address, "Wallet address");
  }

  async function handleQuickFaucet() {
    setBusy(true);
    setError(null);
    setSuccess(null);

    const response = await sendInternal<ChainActionResult>({
      type: "FAUCET_WITHDRAW",
      amount: faucetAmount,
    });

    if (!response.ok) {
      setError(response.error);
      setBusy(false);
      return;
    }

    setSuccess(`Faucet withdrew ${response.data.amount} THRU. Sig: ${response.data.signature}`);
    await refreshBalance();
    setBusy(false);
  }

  return (
    <div className="min-h-[520px] w-[380px] bg-[radial-gradient(circle_at_top,_rgba(248,113,113,0.28),_transparent_38%),linear-gradient(180deg,_#4c0519_0%,_#1f1117_55%,_#12070b_100%)] p-5 text-white">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-rose-200/75">ThruShield</p>
          <h1 className="text-xl font-semibold text-white">
            {view === "settings" ? "Settings" : "Developer Wallet"}
          </h1>
          {view === "dashboard" && shortAddress && (
            <button
              type="button"
              onClick={() => copyText(activeAddress, "Wallet address")}
              className="mt-3 flex max-w-[230px] items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-left text-xs text-rose-50/90 backdrop-blur-md transition hover:border-rose-200/50 hover:bg-white/14"
            >
              <span className="truncate font-mono">{shortAddress}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-[0.22em] text-rose-100/70">Copy</span>
            </button>
          )}
        </div>
        {state?.isUnlocked && (
          <div className="flex gap-2">
            {view === "settings" ? (
              <button
                type="button"
                onClick={() => {
                  setView("dashboard");
                  setExportedKey(null);
                  setShowExportForm(false);
                  setSettingsPassword("");
                }}
                className="rounded-xl border border-white/15 bg-white/8 px-3 py-1.5 text-xs text-rose-50/90 backdrop-blur-md hover:border-rose-200/50"
              >
                Back
              </button>
            ) : (
              <button
                type="button"
                onClick={openSettings}
                className="rounded-xl border border-white/15 bg-white/8 px-3 py-1.5 text-xs text-rose-50/90 backdrop-blur-md hover:border-rose-200/50"
              >
                Settings
              </button>
            )}
            <button
              type="button"
              onClick={handleLock}
              className="rounded-xl border border-white/15 bg-white/8 px-3 py-1.5 text-xs text-rose-50/90 backdrop-blur-md hover:border-rose-200/50"
            >
              Lock
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="mb-4 rounded-2xl border border-red-200/25 bg-red-500/12 px-3 py-2 text-sm text-red-50 backdrop-blur-md">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 break-all rounded-2xl border border-rose-200/25 bg-white/10 px-3 py-2 text-xs text-rose-50 backdrop-blur-md">
          {success}
        </div>
      )}

      {generatedMnemonic && (
        <div className="mb-4 rounded-2xl border border-amber-200/25 bg-white/10 p-3 text-sm text-amber-50 backdrop-blur-md">
          <p className="mb-2 font-medium">Save your recovery phrase offline:</p>
          <p className="font-mono text-xs leading-6">{generatedMnemonic}</p>
        </div>
      )}

      {view === "create" && (
        <form onSubmit={handleCreateWallet} className="space-y-4">
          <p className="text-sm text-rose-50/72">
            Create a new encrypted vault. Keys are derived with PBKDF2 and stored with AES-GCM-256.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-rose-50/84">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-white outline-none backdrop-blur-md placeholder:text-rose-100/40"
              required
              minLength={12}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-2xl bg-gradient-to-r from-rose-500 to-red-500 px-4 py-2 text-sm font-medium text-white shadow-[0_16px_32px_rgba(239,68,68,0.28)] hover:from-rose-400 hover:to-red-400 disabled:opacity-50"
            >
              Generate Wallet
            </button>
            <button
              type="button"
              onClick={() => setView("import")}
              className="rounded-2xl border border-white/15 bg-white/8 px-4 py-2 text-sm text-rose-50/90 backdrop-blur-md"
            >
              Import
            </button>
          </div>
        </form>
      )}

      {view === "import" && (
        <form onSubmit={handleImportWallet} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-rose-50/84">Recovery Phrase</span>
            <textarea
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              className="h-24 w-full rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-white outline-none backdrop-blur-md placeholder:text-rose-100/40"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-rose-50/84">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-white outline-none backdrop-blur-md placeholder:text-rose-100/40"
              required
              minLength={12}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-2xl bg-gradient-to-r from-rose-500 to-red-500 px-4 py-2 text-sm font-medium text-white shadow-[0_16px_32px_rgba(239,68,68,0.28)] hover:from-rose-400 hover:to-red-400 disabled:opacity-50"
            >
              Import Wallet
            </button>
            <button
              type="button"
              onClick={() => setView("create")}
              className="rounded-2xl border border-white/15 bg-white/8 px-4 py-2 text-sm text-rose-50/90 backdrop-blur-md"
            >
              Back
            </button>
          </div>
        </form>
      )}

      {view === "unlock" && (
        <form onSubmit={handleUnlock} className="space-y-4">
          <p className="text-sm text-rose-50/72">Enter your password to decrypt the vault in memory.</p>
          <label className="block text-sm">
            <span className="mb-1 block text-rose-50/84">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-white outline-none backdrop-blur-md placeholder:text-rose-100/40"
              required
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-gradient-to-r from-rose-500 to-red-500 px-4 py-2 text-sm font-medium text-white shadow-[0_16px_32px_rgba(239,68,68,0.28)] hover:from-rose-400 hover:to-red-400 disabled:opacity-50"
          >
            Unlock
          </button>
        </form>
      )}

      {view === "settings" && state && (
        <div className="space-y-5">
          <section className="rounded-[28px] border border-white/12 bg-white/10 p-4 backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-white">Accounts</h2>
              <span className="text-xs text-rose-50/60">{state.accounts.length} total</span>
            </div>
            <ul className="space-y-2">
              {state.accounts.map((account) => (
                <li
                  key={account.id}
                  className={`rounded-lg border px-3 py-2 ${
                    account.isActive
                      ? "border-rose-300/35 bg-rose-500/10"
                      : "border-white/10 bg-black/10"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-white">
                        {account.name}
                        {account.isActive && (
                          <span className="ml-2 text-xs text-rose-200">active</span>
                        )}
                      </p>
                      <p className="truncate font-mono text-xs text-rose-50/55">{account.address}</p>
                    </div>
                    {!account.isActive && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleSwitchAccount(account.id)}
                        className="shrink-0 text-xs text-rose-100 hover:text-white disabled:opacity-50"
                      >
                        Switch
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <form onSubmit={handleAddAccount} className="mt-4 space-y-2 border-t border-white/10 pt-4">
              <p className="text-xs text-rose-50/60">
                Create another HD account from the same recovery phrase (password required).
              </p>
              <input
                type="text"
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="Account name (optional)"
                className="w-full rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none backdrop-blur-md placeholder:text-rose-100/40"
              />
              <input
                type="password"
                value={settingsPassword}
                onChange={(e) => setSettingsPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none backdrop-blur-md placeholder:text-rose-100/40"
                required
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-2xl bg-gradient-to-r from-rose-500 to-red-500 px-3 py-2 text-sm font-medium text-white shadow-[0_16px_32px_rgba(239,68,68,0.28)] hover:from-rose-400 hover:to-red-400 disabled:opacity-50"
              >
                {busy ? "…" : "Create another wallet"}
              </button>
            </form>
          </section>

          <section className="rounded-[28px] border border-white/12 bg-white/10 p-4 backdrop-blur-xl">
            <h2 className="text-sm font-medium text-amber-50">Export private key</h2>
            <p className="mt-1 text-xs text-amber-50/70">
              Never share this key. Anyone with it can control the active account.
            </p>

            {!showExportForm ? (
              <button
                type="button"
                onClick={() => {
                  setShowExportForm(true);
                  setExportedKey(null);
                  setSettingsPassword("");
                }}
                className="mt-3 w-full rounded-2xl border border-amber-100/30 bg-white/6 px-3 py-2 text-sm text-amber-50 hover:border-amber-50/50"
              >
                Reveal export form
              </button>
            ) : (
              <form onSubmit={handleExportKey} className="mt-3 space-y-2">
                <input
                  type="password"
                  value={settingsPassword}
                  onChange={(e) => setSettingsPassword(e.target.value)}
                  placeholder="Confirm password"
                  className="w-full rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none backdrop-blur-md placeholder:text-rose-100/40"
                  required
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex-1 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-2 text-sm font-medium text-white hover:from-amber-400 hover:to-orange-400 disabled:opacity-50"
                  >
                    {busy ? "…" : "Export key"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowExportForm(false);
                      setExportedKey(null);
                      setSettingsPassword("");
                    }}
                    className="rounded-2xl border border-white/15 bg-white/8 px-3 py-2 text-sm text-rose-50/90 backdrop-blur-md"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {exportedKey && (
              <div className="mt-3 space-y-2 rounded-2xl border border-amber-100/25 bg-black/15 p-3 backdrop-blur-md">
                <p className="text-xs text-rose-50/60">{exportedKey.accountName}</p>
                <p className="break-all font-mono text-xs text-rose-100">{exportedKey.address}</p>
                <p className="text-xs uppercase tracking-wide text-amber-100">Private key (hex)</p>
                <p className="break-all font-mono text-xs text-amber-50">{exportedKey.privateKeyHex}</p>
                <button
                  type="button"
                  onClick={async () => {
                    await copyText(exportedKey.privateKeyHex, "Private key");
                  }}
                  className="w-full rounded-2xl border border-white/15 bg-white/8 px-3 py-1.5 text-xs text-rose-50/90 backdrop-blur-md hover:border-rose-200/50"
                >
                  Copy private key
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {view === "dashboard" && state && (
        <div className="space-y-5">
          <section className="rounded-[32px] border border-white/12 bg-white/10 p-4 shadow-[0_24px_60px_rgba(30,10,14,0.45)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.28em] text-rose-100/70">
                  {activeAccount?.name ?? "Active Account"}
                </p>
                <div className="mt-3 rounded-2xl border border-white/12 bg-black/10 px-3 py-2 backdrop-blur-md">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-rose-100/60">Wallet Address</p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="truncate font-mono text-sm text-white">{state.address}</p>
                    <button
                      type="button"
                      onClick={handleReceive}
                      className="shrink-0 rounded-full border border-white/12 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-rose-100/75 hover:border-rose-100/50"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => refreshBalance()}
                className="shrink-0 rounded-full border border-white/12 bg-white/6 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-rose-100/80 backdrop-blur-md hover:border-rose-100/50 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            <div className="mt-5">
              <p className="text-xs uppercase tracking-[0.28em] text-rose-100/60">Balance</p>
              <p className="mt-2 text-4xl font-semibold leading-none text-white">
                {balance ? balance.balance : "…"}
                <span className="ml-2 text-base font-medium text-rose-100/75">THRU</span>
              </p>
              <div className="mt-2 flex items-center justify-between text-xs text-rose-100/60">
                <span>{balance && !balance.exists ? "On-chain account will be created by faucet" : "Wallet ready"}</span>
                {balance && <span>nonce {balance.nonce}</span>}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsSendOpen((current) => !current);
                  setError(null);
                  setSuccess(null);
                }}
                className={`rounded-[22px] px-3 py-3 text-sm font-medium transition ${
                  isSendOpen
                    ? "bg-gradient-to-r from-rose-500 to-red-500 text-white shadow-[0_18px_36px_rgba(239,68,68,0.28)]"
                    : "border border-white/12 bg-white/8 text-rose-50/92 backdrop-blur-md hover:border-rose-100/50"
                }`}
              >
                Send
              </button>
              <button
                type="button"
                onClick={handleReceive}
                className="rounded-[22px] border border-white/12 bg-white/8 px-3 py-3 text-sm font-medium text-rose-50/92 backdrop-blur-md hover:border-rose-100/50"
              >
                Receive
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleQuickFaucet}
                className="flex items-center justify-center gap-2 rounded-[22px] border border-white/12 bg-white/8 px-3 py-3 text-sm font-medium text-rose-50/92 backdrop-blur-md hover:border-rose-100/50 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
                  <path d="M8 6h8" strokeLinecap="round" />
                  <path d="M12 6V4a2 2 0 0 1 2-2h3" strokeLinecap="round" />
                  <path d="M17 2v5a2 2 0 0 1-2 2H6a2 2 0 0 0-2 2v1" strokeLinecap="round" />
                  <path d="M7 13c0 1.9-2 2.8-2 4.8A3 3 0 0 0 8 21a3 3 0 0 0 3-3.2c0-2-2-2.9-2-4.8 0-1.1.7-2.1 1.8-2.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Faucet
              </button>
            </div>

            {isSendOpen && (
              <form onSubmit={handleTransfer} className="mt-4 space-y-3 rounded-[24px] border border-rose-100/18 bg-black/12 p-4 backdrop-blur-md">
                <label className="block text-xs uppercase tracking-[0.24em] text-rose-100/65">
                  Destination Address
                  <input
                    type="text"
                    value={transferTo}
                    onChange={(e) => setTransferTo(e.target.value)}
                    placeholder="Paste destination address"
                    className="mt-2 w-full rounded-2xl border border-white/12 bg-white/8 px-3 py-3 font-mono text-xs text-white outline-none placeholder:text-rose-100/35"
                    required
                  />
                </label>
                <label className="block text-xs uppercase tracking-[0.24em] text-rose-100/65">
                  Amount
                  <input
                    type="text"
                    inputMode="numeric"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/12 bg-white/8 px-3 py-3 text-sm text-white outline-none placeholder:text-rose-100/35"
                    required
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-2xl bg-gradient-to-r from-rose-500 to-red-500 px-4 py-3 text-sm font-medium text-white shadow-[0_18px_36px_rgba(239,68,68,0.28)] hover:from-rose-400 hover:to-red-400 disabled:opacity-50"
                >
                  {busy ? "Sending..." : "Confirm Send"}
                </button>
              </form>
            )}

            {state.accounts.length > 1 && (
              <p className="mt-4 text-xs text-rose-100/60">
                {state.accounts.length} accounts available. Manage them in Settings.
              </p>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-white">Authorized dApps</h2>
              <span className="text-xs text-rose-100/60">{dapps.length} connected</span>
            </div>
            {dapps.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/12 bg-white/6 p-4 text-sm text-rose-100/60 backdrop-blur-md">
                No authorized origins yet. dApps must pass an explicit connect approval.
              </p>
            ) : (
              <ul className="space-y-2">
                {dapps.map((dapp) => (
                  <li
                    key={dapp.origin}
                    className="flex items-center justify-between rounded-2xl border border-white/12 bg-white/8 px-3 py-2 backdrop-blur-md"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <p className="truncate text-sm text-white">{dapp.origin}</p>
                      <p className="truncate font-mono text-xs text-rose-100/55">{dapp.publicKey}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevoke(dapp.origin)}
                      className="text-xs text-rose-200 hover:text-white"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
