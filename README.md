# ThruShield

A secure, **open source**, developer-focused Chrome wallet extension for the
[Thru](https://thru.org) blockchain.

ThruShield is **non-custodial** and **100% open source** — your keys are generated
and stored only on your device, and the entire codebase is public so anyone can
audit how funds are handled.

## Alpha / Testnet Notice

ThruShield currently targets the **Thru Alphanet** (testnet). The bundled RPC,
faucet, and token actions run on testnet infrastructure only — **no real funds
are involved**. Use at your own risk; the API and storage format may change.

## Install (from this repo)

```bash
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, and click
**Load unpacked** → select the `dist/` folder.

## Security Model

- **Non-custodial** — the mnemonic is generated locally; the private key lives
  only in memory while unlocked and is wiped (`secureZero`) on lock.
- **Encrypted vault** — AES-GCM-256 in `chrome.storage.local`, key derived from
  your password via PBKDF2-SHA256 (310,000 iterations).
- **Auto-lock** — keys are wiped from memory after 15 minutes of inactivity.
- **Origin allowlist** — `connect`, `getSigningContext`, and `signTransaction`
  require authorized origins.
- **No blind signing** — confirmation popups decode transaction fields via
  `@thru/sdk`.

Permissions: `storage`, `activeTab`, `alarms`, plus host access for `*.thru.org` /
`*.thruput.org`.

## dApp API (`window.thruWallet`)

```ts
await window.thruWallet.connect();
await window.thruWallet.getSigningContext();

// Raw wire / signing payload (base64)
await window.thruWallet.signTransaction(signingPayloadBase64);

// Or official-style transaction intent (wallet builds the wire tx)
await window.thruWallet.signTransaction({
  programAddress,
  instructionData, // base64
  readWriteAddresses,
  readOnlyAddresses,
});
```

Wallet signs; the dApp submits the returned raw transaction bytes with `@thru/sdk`.

## Usage

After unlocking (create a new wallet or import a mnemonic):

1. **Get Faucet** — creates the on-chain account if needed, then withdraws from
   the faucet (max 10,000).
2. **Transfer Tokens** — native EOA transfer (fee = 1).

RPC: `https://rpc.alphanet.thru.org`

You can also **add / switch accounts** (HD wallet under one mnemonic),
**export the private key** (password required), and **wipe the wallet** from the popup.

## Contributing

PRs are welcome. Open an issue first for non-trivial changes, follow Conventional
Commits, and make sure `npm run build` passes before opening a PR.

## License

Distributed under the **MIT License**. See [LICENSE](./LICENSE).

## Disclaimer

Provided "as is", without warranty. Alpha stage software on the Thru testnet.
The authors are not responsible for any loss of funds. Always verify the
transaction preview before signing.

## Version

ThruShield Beta v0.1.0.4 — uses `@thru/sdk` 0.3.0 (compatible with alphanet / CLI `thru@0.3.0`).
