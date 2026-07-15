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

  return (
    <div className="min-h-[520px] w-[380px] bg-gradient-to-b from-slate-950 to-slate-900 p-5">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-teal-400">ThruShield</p>
          <h1 className="text-xl font-semibold text-white">
            {view === "settings" ? "Settings" : "Developer Wallet"}
          </h1>
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
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-teal-500"
              >
                Back
              </button>
            ) : (
              <button
                type="button"
                onClick={openSettings}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-teal-500"
              >
                Settings
              </button>
            )}
            <button
              type="button"
              onClick={handleLock}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-teal-500"
            >
              Lock
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 break-all rounded-lg border border-teal-500/40 bg-teal-950/30 px-3 py-2 text-xs text-teal-100">
          {success}
        </div>
      )}

      {generatedMnemonic && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-100">
          <p className="mb-2 font-medium">Save your recovery phrase offline:</p>
          <p className="font-mono text-xs leading-6">{generatedMnemonic}</p>
        </div>
      )}

      {view === "create" && (
        <form onSubmit={handleCreateWallet} className="space-y-4">
          <p className="text-sm text-slate-400">
            Create a new encrypted vault. Keys are derived with PBKDF2 and stored with AES-GCM-256.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-300">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              required
              minLength={12}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            >
              Generate Wallet
            </button>
            <button
              type="button"
              onClick={() => setView("import")}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
            >
              Import
            </button>
          </div>
        </form>
      )}

      {view === "import" && (
        <form onSubmit={handleImportWallet} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-300">Recovery Phrase</span>
            <textarea
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              className="h-24 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-300">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              required
              minLength={12}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            >
              Import Wallet
            </button>
            <button
              type="button"
              onClick={() => setView("create")}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
            >
              Back
            </button>
          </div>
        </form>
      )}

      {view === "unlock" && (
        <form onSubmit={handleUnlock} className="space-y-4">
          <p className="text-sm text-slate-400">Enter your password to decrypt the vault in memory.</p>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-300">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              required
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            Unlock
          </button>
        </form>
      )}

      {view === "settings" && state && (
        <div className="space-y-5">
          <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-white">Accounts</h2>
              <span className="text-xs text-slate-500">{state.accounts.length} total</span>
            </div>
            <ul className="space-y-2">
              {state.accounts.map((account) => (
                <li
                  key={account.id}
                  className={`rounded-lg border px-3 py-2 ${
                    account.isActive
                      ? "border-teal-500/50 bg-teal-950/20"
                      : "border-slate-800 bg-slate-950/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-white">
                        {account.name}
                        {account.isActive && (
                          <span className="ml-2 text-xs text-teal-400">active</span>
                        )}
                      </p>
                      <p className="truncate font-mono text-xs text-slate-500">{account.address}</p>
                    </div>
                    {!account.isActive && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleSwitchAccount(account.id)}
                        className="shrink-0 text-xs text-teal-300 hover:text-teal-200 disabled:opacity-50"
                      >
                        Switch
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <form onSubmit={handleAddAccount} className="mt-4 space-y-2 border-t border-slate-800 pt-4">
              <p className="text-xs text-slate-500">
                Create another HD account from the same recovery phrase (password required).
              </p>
              <input
                type="text"
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="Account name (optional)"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
              <input
                type="password"
                value={settingsPassword}
                onChange={(e) => setSettingsPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                required
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
              >
                {busy ? "…" : "Create another wallet"}
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-4">
            <h2 className="text-sm font-medium text-amber-100">Export private key</h2>
            <p className="mt-1 text-xs text-amber-200/80">
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
                className="mt-3 w-full rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-100 hover:border-amber-400"
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
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  required
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex-1 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
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
                    className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {exportedKey && (
              <div className="mt-3 space-y-2 rounded-lg border border-amber-500/40 bg-slate-950/80 p-3">
                <p className="text-xs text-slate-400">{exportedKey.accountName}</p>
                <p className="break-all font-mono text-xs text-teal-300">{exportedKey.address}</p>
                <p className="text-xs uppercase tracking-wide text-amber-200">Private key (hex)</p>
                <p className="break-all font-mono text-xs text-amber-100">{exportedKey.privateKeyHex}</p>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(exportedKey.privateKeyHex);
                    setSuccess("Private key copied to clipboard");
                  }}
                  className="w-full rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-teal-500"
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
          <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  {state.accounts.find((a) => a.isActive)?.name ?? "Active Account"}
                </p>
                <p className="mt-2 break-all font-mono text-sm text-teal-300">{state.address}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => refreshBalance()}
                className="shrink-0 text-xs text-slate-400 hover:text-teal-300 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Balance</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {balance ? `${balance.balance} THRU` : "…"}
                </p>
                {balance && !balance.exists && (
                  <p className="mt-1 text-xs text-amber-300">Not on-chain yet — faucet will create it</p>
                )}
              </div>
              {balance && <p className="text-xs text-slate-500">nonce {balance.nonce}</p>}
            </div>
            {state.accounts.length > 1 && (
              <p className="mt-3 text-xs text-slate-500">
                {state.accounts.length} accounts — manage in Settings
              </p>
            )}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <h2 className="text-sm font-medium text-white">Get Faucet</h2>
            <p className="mt-1 text-xs text-slate-500">
              Alphanet faucet withdraw (max 10,000). Same flow as{" "}
              <code className="text-slate-400">thru faucet withdraw</code>.
            </p>
            <form onSubmit={handleFaucet} className="mt-3 flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={faucetAmount}
                onChange={(e) => setFaucetAmount(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                required
              />
              <button
                type="submit"
                disabled={busy}
                className="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
              >
                {busy ? "…" : "Withdraw"}
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <h2 className="text-sm font-medium text-white">Transfer Tokens</h2>
            <p className="mt-1 text-xs text-slate-500">
              Native transfer via EOA program. Same as{" "}
              <code className="text-slate-400">thru transfer</code> (fee = 1).
            </p>
            <form onSubmit={handleTransfer} className="mt-3 space-y-2">
              <input
                type="text"
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                placeholder="Destination ta…"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs"
                required
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  required
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
                >
                  {busy ? "…" : "Send"}
                </button>
              </div>
            </form>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-white">Authorized dApps</h2>
              <span className="text-xs text-slate-500">{dapps.length} connected</span>
            </div>
            {dapps.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-800 p-4 text-sm text-slate-500">
                No authorized origins yet. dApps must pass an explicit connect approval.
              </p>
            ) : (
              <ul className="space-y-2">
                {dapps.map((dapp) => (
                  <li
                    key={dapp.origin}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <p className="truncate text-sm text-white">{dapp.origin}</p>
                      <p className="truncate font-mono text-xs text-slate-500">{dapp.publicKey}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevoke(dapp.origin)}
                      className="text-xs text-red-300 hover:text-red-200"
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
