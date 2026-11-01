# Contributing to Noir Wallet

Thanks for your interest in improving Noir Wallet — the x402 contactless payment wallet powered by Stellar. This guide covers how to get set up, make changes, and open a pull request.

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to Contribute

- Fix bugs — check issues labeled `bug`.
- Build features — the roadmap is driven by user feedback (see the README). Items labeled `good first issue` are a great start.
- Improve smart contracts — `device_registry`, `agent_registry`, `payment_escrow`.
- Polish UI/UX — the app follows a documented design system (`frontend/DESIGN.md`).
- Write docs or report issues — a good bug report is a contribution.

For anything larger than a small fix, open an issue first so we can align on approach.

## Development Setup

### Prerequisites

- Node.js 22.23.4+ and Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (macOS) or Android Emulator / device
- A Stellar testnet wallet (Freighter or custom)
- Rust toolchain + `soroban-cli` for contract work

### Frontend (React Native / Expo)

```bash
git clone https://github.com/noirx402/noir.git
cd noir/frontend
npm install
cp .env.example .env      # fill in contract IDs (see README env table)
npx expo start
```

Press `a` for Android, `i` for iOS, or scan the QR with Expo Go.

Scripts (`frontend/package.json`):

| Command | Purpose |
|---------|---------|
| `npm start` | Start Expo dev server |
| `npm run android` / `npm run ios` | Build & run on device/simulator |
| `npm run web` | Run in the browser |
| `npm test` | Run Vitest once |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Coverage report |
| `npm run stellar` | Stellar CLI helper |

### Smart Contracts (Soroban / Rust)

```bash
cd backend
cargo check -p device-registry -p agent-registry -p payment-escrow
cargo test  -p device-registry -p agent-registry -p payment-escrow
cargo build --release --target wasm32v1-none \
  -p device-registry -p agent-registry -p payment-escrow
```

Deployment steps are in the [README](README.md#smart-contract-development). **Never** commit secrets, admin keypairs, or `.env` files.

## Branching & Workflow

1. Fork (external) or branch (maintainers) off `main`.
2. Use a topic branch: `feat/qr-scanner`, `fix/nfc-timeout`, `docs/contributing`.
3. Make focused commits; keep the branch current with `git rebase main`.
4. Open a PR against `main`. Do **not** push directly to `main`.

## Coding Standards

**TypeScript / Frontend**
- Strict mode; avoid `any` (justify with a comment if unavoidable).
- Import design values from `src/constants/designTokens.ts` — never hardcode colors, spacing, or font sizes.
- Follow existing folder conventions; prefer functional components and hooks.
- Use the existing Zustand state layer.

**Rust / Contracts**
- Run `cargo fmt` and `cargo clippy` before committing.
- Any method acting on behalf of a wallet must enforce authorization (`wallet.require_auth()` or the agent-auth path via `agent_registry`).
- Add tests for every new method and for auth edge cases.

**General**
- Small, reviewable PRs. No secrets or real credentials in code/tests/fixtures.
- Preserve accessibility (touch targets, contrast, dynamic type).

## Testing

- Frontend: `cd frontend && npm test`.
- Contracts: `cd backend && cargo test -p <contract>`.
- CI runs on PRs (`.github/workflows/`); PRs should be green before review.
- If you fix a bug, add a test that fails without your change.

## Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <summary>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`.

```
feat(pos): add QR code scanner on the receive screen
fix(nfc): handle read timeout on Android devices
test(payment-escrow): cover defund after partial claim
```

Keep summaries under ~70 chars, imperative mood.

## Pull Requests

Before opening a PR:

- [ ] Builds and relevant tests pass (`npm test` and/or `cargo test`).
- [ ] New behavior has tests.
- [ ] No secrets, keys, or `.env` files committed.
- [ ] Commits follow the convention.
- [ ] PR describes **what**, **why**, and **how it was tested**.

Fill out the PR template. Squash-merge is the default.

## Reporting Bugs & Requesting Features

Use the GitHub issue templates. Search existing issues first. For bugs, include steps to reproduce, expected vs actual, and environment (device, OS, network: testnet/mainnet).

## Security Issues

**Do not** open a public issue for vulnerabilities — especially anything affecting keys, authorization, or fund custody. Follow [SECURITY.md](SECURITY.md).

---

Thanks for contributing. 🖤🪙

## Branch Protection

`main` is a protected branch. All changes land via pull request:

- A pull request with **at least 1 approving review** is required.
- The **Frontend CI `test`** check must pass, and your branch must be up to date with `main`.
- **Conversations must be resolved** before merging.
- **Linear history** is required — rebase your branch (`git rebase main`), don't merge `main` into it.
- Force pushes and branch deletion on `main` are disabled.
- Protection is **enforced for administrators** too — nobody pushes directly to `main`.

Code review is routed via [`.github/CODEOWNERS`](.github/CODEOWNERS).
