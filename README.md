# ThruShield

Highly secure, developer-focused Chrome wallet extension for the Thru blockchain.

## Architecture

```
dApp (window.thruWallet)
    ↕ postMessage
Inpage Script (no secrets)
    ↕ postMessage
Content Script (isolated world)
    ↕ chrome.runtime.sendMessage
Background Service Worker (crypto, signing, storage)
    ↕ chrome.runtime.sendMessage
Popup / Confirmation UI (React + Tailwind)
```

## Security Model

- **Manifest V3** with strict extension-page CSP
- **AES-GCM-256** encrypted vault in `chrome.storage.local`
- **PBKDF2-SHA256** (310,000 iterations) key derivation from user password
- **Auto-lock** after 15 minutes of inactivity (decrypted keys wiped from memory)
- **Origin whitelist** — `connect`, `getSigningContext`, and `signTransaction` require authorized origins (except initial `connect` approval flow)
- **Sandboxed confirmation popups** — no blind signing; transaction fields are decoded via `@thru/thru-sdk`

## Development

```bash
npm install
npm run build
```

Load `dist` as an unpacked extension in `chrome://extensions`.

## Alphanet actions (popup)

After unlocking:

1. **Get Faucet** — creates the on-chain account if needed, then withdraws from the faucet (max 10,000), matching [`thru faucet withdraw`](https://thru.org/docs/cli-reference/faucet-commands/) and the [first-transaction guide](https://github.com/Nassami1/thru-First-transaction).
2. **Transfer Tokens** — native EOA transfer matching `thru transfer <src> <dst> <value>` (fee = 1).

RPC: `https://rpc.alphanet.thru.org` (Thru CLI / current SDK default).

## dApp Provider API

```ts
await window.thruWallet.connect();
await window.thruWallet.getSigningContext();
const signed = await window.thruWallet.signTransaction(base64Payload);
await window.thruWallet.disconnect();
```

## Permissions

MV3 permissions: `storage`, `activeTab`, plus host access for alphanet RPC.