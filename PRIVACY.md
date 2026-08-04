# Privacy Policy for ThruShield Wallet

**Last Updated: August 2026**

ThruShield is a secure, open-source, non-custodial Chrome wallet extension for the Thru blockchain. Your privacy and security are our highest priorities. This Privacy Policy describes how ThruShield handles your information.

---

## 1. Non-Custodial Architecture (No Collection of Private Data)
ThruShield is a **non-custodial** wallet. This means:
* **We do not collect, store, or transmit your private keys, seed phrases (mnemonics), or wallet passwords.**
* All cryptographic keys and mnemonics are generated locally on your device and are kept strictly in your system's volatile memory while the wallet is unlocked.
* Your encrypted vault is stored locally on your device using Chrome's secure local storage (`chrome.storage.local`) with AES-GCM-256 encryption.
* We have no access to your funds, your passwords, or your keys. If you lose your seed phrase, we cannot recover it for you.

## 2. No Tracking or Personal Data Collection
* **Personal Identifiable Information (PII):** We do not collect personal information such as your name, email address, physical address, IP address, or phone number.
* **Usage Analytics:** ThruShield does not use any third-party tracking scripts, cookies, or analytics services. Your browsing activity remains completely private.

## 3. Network Interactions & Blockchain Connectivity
To interact with the Thru blockchain (Alphanet/Testnet), ThruShield must communicate with public blockchain nodes (RPC endpoints):
* When you view your balances, fetch transaction history, or broadcast signed transactions, ThruShield sends requests to authorized Thru endpoints (`*.thru.org` and `*.thruput.org`).
* During these requests, only public blockchain data (such as your public wallet address and transaction payloads) is transmitted to the nodes. No private data is ever shared.

## 4. Extension Permissions & How They Are Used
ThruShield requests a minimal set of permissions to function securely:
* **`storage`:** Used strictly to persist your local encrypted wallet vault and preferences on your device.
* **`activeTab`:** Used only to interact with the active browser tab when you explicitly authorize a dApp connection or signature request.
* **`alarms`:** Used solely to power the auto-lock security timer, which automatically wipes private keys from memory after 15 minutes of inactivity.

## 5. Third-Party Websites & dApps
When using ThruShield to connect with decentralized applications (dApps), those dApps are third-party websites with their own privacy policies. ThruShield is not responsible for how those external sites collect or handle your data. Always ensure you trust the dApps you connect to.

## 6. Open Source and Transparency
ThruShield is 100% open-source under the MIT license. You can inspect, audit, and verify our entire source code, build process, and dependency tree at our official GitHub repository:
[github.com/tokyob12/thrushield-wallet](https://github.com/tokyob12/thrushield-wallet)

## 7. Contact Us
If you have any questions or security concerns regarding this Privacy Policy, please open an issue in our official GitHub repository.
