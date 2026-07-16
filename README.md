# ThruShield

A secure, **open-source**, developer focused Chrome wallet extension for the
[Thru](https://thru.org) blockchain.

<img width="471" height="706" alt="Screenshot 2026-07-15 163908" src="https://github.com/user-attachments/assets/f897f8b5-21e4-447f-9d3d-8b7bb8e19473" />


ThruShield is **non-custodial** and **100% open source** , your keys are generated
and stored only on your device, and the entire codebase is public so anyone can
audit how funds are handled.

## Alpha / Testnet Notice

ThruShield currently targets the **Thru Alphanet** (testnet). The bundled RPC,
faucet, and token actions run on testnet infrastructure only , **no real funds
are involved**. Use at your own risk; the API and storage format may change.

## Install

Download the ready to use build instead of building from source:

- Go to **[Releases](https://github.com/tokyob12/thrushield-wallet/releases/tag/v0.1.0-beta)** and download the latest `dist` package, **or**
- Download `dist.zip` directly from the repository root.

Then open `chrome://extensions`, enable **Developer mode**, and click
**Load unpacked** → select the unzipped `dist/` folder.

## Security Model

- **Non-custodial** — the mnemonic is generated locally; the private key lives
  only in memory while unlocked and is wiped (`secureZero`) on lock.
- **Encrypted vault** — AES-GCM-256 in `chrome.storage.local`, key derived from
  your password via PBKDF2-SHA256 (310,000 iterations).
- **Auto-lock** — keys are wiped from memory after 15 minutes of inactivity.
- **Origin allowlist** — `connect`, `getSigningContext`, and `signTransaction`
  require authorized origins.
- **No blind signing** — confirmation popups decode transaction fields via
  `@thru/thru-sdk`.

Permissions: `storage`, `activeTab`, plus host access for `*.thru.org` / `*.thruput.org`.

## Usage

After unlocking (create a new wallet or import a mnemonic):

1. **Get Faucet** — creates the on-chain account if needed, then withdraws from
   the faucet (max 10,000), matching [`thru faucet withdraw`](https://thru.org/docs/cli-reference/faucet-commands/)
   and the [first-transaction guide](https://github.com/Nassami1/thru-First-transaction).
2. **Transfer Tokens** — native EOA transfer matching `thru transfer <src> <dst> <value>`
   (fee = 1).

RPC: `https://rpc.alphanet.thru.org`

You can also **add / switch accounts** (HD wallet under one mnemonic),
**export the private key** (password required), and **wipe the wallet** from the popup.

## Contributing

PRs are welcome. Open an issue first for non trivial changes, follow Conventional
Commits, and make sure `npm run build` passes before opening a PR.

## Open Source

ThruShield is fully open source. Audit the code, verify the crypto, and build it
yourself , trust is placed in the public code, not in a vendor.

## License

Distributed under the **MIT License**. Add a `LICENSE` file to the repo root to
activate it (currently declared in `package.json` but the file is missing).

## Disclaimer

⚠️Provided "as is", without warranty. Alpha stage software on the Thru testnet.
The authors are not responsible for any loss of funds. Always verify the
transaction preview before signing.
