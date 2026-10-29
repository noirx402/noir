# Security Policy

Noir Wallet handles cryptographic keys, device authorization, and on-chain funds. We take security seriously and appreciate responsible disclosure.

## Supported Versions

This project is under active development. Security fixes are applied to the latest `main` and the most recent released version.

| Version | Supported |
|---------|-----------|
| latest `main` | ✅ |
| older tags | ❌ |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report privately using one of:

- GitHub's [private security advisory](https://github.com/noirx402/noir/security/advisories/new) ("Report a vulnerability")
- A direct, confidential message to the maintainer ([@ChichiCode0](https://x.com/ChichiCode0))

Include, where possible:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept if available)
- Affected component (frontend, `device_registry`, `agent_registry`, `payment_escrow`)
- Network (testnet / mainnet) and contract ID if relevant
- Any suggested remediation

## What to Expect

- **Acknowledgement** within 72 hours.
- An initial assessment and severity rating shortly after.
- Regular updates on remediation progress.
- Public disclosure coordinated with you after a fix is released. We are happy to credit you unless you prefer to remain anonymous.

Please give us reasonable time to remediate before any public disclosure.

## Scope

**In scope:**

- Smart contract logic in `backend/contracts/*` — authorization bypass, fund theft/lock, integer overflow, replay, or escrow-accounting errors.
- Frontend key handling — seed/key storage, signing flows, x402 agent authorization.
- Device provisioning — device-hash collision or spoofing that maps a device to the wrong wallet.

**Out of scope:**

- Vulnerabilities in third-party dependencies already reported upstream (report to them; let us know so we can bump versions).
- Issues requiring physical access to an unlocked device.
- Social engineering of maintainers or users.
- Testnet-only issues with no mainnet impact (still welcome, but lower priority).

## Security Best Practices for Contributors

- Never commit private keys, seed phrases, `.env` files, or admin keypairs.
- Enforce authorization on every state-changing contract method (`wallet.require_auth()` or the agent-auth path).
- Validate and bound all amounts; guard against overflow/underflow.
- Treat all NFC/tag input as untrusted; hash device UIDs (SHA-256) before use.
- Add tests covering authorization failure and boundary conditions.

Thank you for helping keep Noir Wallet and its users safe.
