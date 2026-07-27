import { useEffect, useState } from "react";
import type { InternalMessage, InternalResponse, PendingApproval } from "../../types/messages";

async function sendInternal<T>(payload: InternalMessage): Promise<InternalResponse<T>> {
  return chrome.runtime.sendMessage({
    source: "thruShield-internal",
    payload,
  });
}

function getApprovalId(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

export default function ConfirmApp() {
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const approvalId = getApprovalId();
    if (!approvalId) {
      setError("Missing approval request ID");
      return;
    }

    sendInternal<PendingApproval>({ type: "GET_PENDING_APPROVAL", approvalId })
      .then((response) => {
        if (!response.ok) {
          setError(response.error);
          return;
        }
        setApproval(response.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load approval"));
  }, []);

  async function resolve(approved: boolean) {
    const approvalId = getApprovalId();
    if (!approvalId) {
      return;
    }

    setBusy(true);
    const response = await sendInternal({
      type: "RESOLVE_APPROVAL",
      approvalId,
      approved,
    });

    if (!response.ok) {
      setError(response.error);
      setBusy(false);
      return;
    }

    window.close();
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-red-200">
        <h1 className="text-lg font-semibold">Approval Error</h1>
        <p className="mt-2 text-sm">{error}</p>
      </div>
    );
  }

  if (!approval) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-300">
        <p>Loading approval request…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6 text-slate-100">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-teal-400">ThruShield Approval</p>
        <h1 className="mt-1 text-xl font-semibold">
          {approval.kind === "connect" ? "Connect dApp" : "Sign Transaction"}
        </h1>
      </header>

      <section className="mb-6 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">Requesting Origin</p>
        <div className="mt-3 flex items-center gap-3">
          {approval.faviconUrl ? (
            <img
              src={approval.faviconUrl}
              alt=""
              className="h-10 w-10 rounded-lg border border-slate-700 bg-slate-900"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-xs">
              dApp
            </div>
          )}
          <p className="break-all text-sm font-medium text-white">{approval.origin}</p>
        </div>
      </section>

      {approval.kind === "signTransaction" && (
        <section className="mb-6 space-y-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm">
          <p className="font-medium text-amber-100">Review transaction details before signing</p>
          <Detail label="Fee Payer" value={approval.decoded.feePayer} />
          <Detail label="Program" value={approval.decoded.program} />
          <Detail label="Gas Limit (compute units)" value={String(approval.decoded.gasLimit)} />
          <Detail label="State Units" value={String(approval.decoded.stateUnits)} />
          <Detail label="Memory Units" value={String(approval.decoded.memoryUnits)} />
          <Detail label="Chain ID" value={String(approval.decoded.chainId)} />
          <Detail label="Instruction Data Size" value={String(approval.decoded.instructionDataSize)} />
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Instruction Data (hex)</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-300">
              {approval.decoded.instructionDataHex || "(empty)"}
            </p>
          </div>
          {approval.decoded.readWriteAccounts.length > 0 && (
            <Detail
              label="Read/Write Accounts"
              value={approval.decoded.readWriteAccounts.join(", ")}
            />
          )}
          {approval.decoded.readOnlyAccounts.length > 0 && (
            <Detail label="Read-Only Accounts" value={approval.decoded.readOnlyAccounts.join(", ")} />
          )}
        </section>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve(false)}
          className="flex-1 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-slate-500 disabled:opacity-50"
        >
          Reject
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve(true)}
          className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 break-all font-mono text-xs text-slate-200">{value}</p>
    </div>
  );
}
