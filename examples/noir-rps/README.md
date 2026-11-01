# Noir RPS — rock, paper, scissors on Stellar Testnet

A small dApp that shows the two halves of Noir working together:

- the **Noir browser extension** (`extension/`) connects the player and signs every stake in its approval window;
- the **Noir SDK** ([`@noirx402/agent-sdk`](https://www.npmjs.com/package/@noirx402/agent-sdk)) provides the extension signer, the house's server signer, exact XLM amounts, and reads the player's Noir cards from the Soroban contracts.

Everything runs on Testnet with free test XLM.

## Run it

```bash
# 1. Build and load the extension (once)
cd extension && npm ci && npm run build
#    chrome://extensions → Developer mode → Load unpacked → extension/dist
#    Open the Noir popup, create or import a wallet, and fund it (the popup offers Friendbot).

# 2. Start the game
cd examples/noir-rps && npm install && npm run dev
#    open http://localhost:5173
```

`npm run dev` starts the house server (port 8787) and the page (port 5173). On
first run the house creates its own Testnet account, saves the secret to
`.house-secret` (git-ignored) and funds it with Friendbot. Set `HOUSE_SECRET`
to use an account of your own.

## How a round works

1. **Connect.** `noirExtensionSigner()` asks the extension for access; the page then shows your balance and your Noir cards (`listDevices`, `getPolicy`, `getEscrowBalance`).
2. **Deal.** `GET /api/round` returns a round id and the house's **commitment**: `sha256(roundId:houseMove:salt)`. The house picks its move before you pay.
3. **Stake.** The page builds an XLM payment to the house with the memo `rps:<roundId>:<r|p|s>` and the extension asks you to approve it. Your move is inside the transaction you sign, so nobody watching the chain can play your round with another move.
4. **Settle.** `POST /api/play { roundId, txHash }`. The house reads the payment from Horizon (one XLM payment to the house, 1–5 XLM, matching memo), decides the round, and pays with `keypairSigner`: **2×** on a win, the stake back on a draw.
5. **Verify.** The house reveals its move and salt; the page recomputes the hash and shows **Fair** only if it matches the commitment.

## Code

| Path | What |
|---|---|
| `src/main.ts` | The page: connect, cards, stake, result and fairness check |
| `src/rules.ts` | Outcomes, payouts, memos and the commitment (shared by page, house and tests) |
| `src/stellar.ts` | Horizon helpers: build, submit, balances |
| `server/house.ts` | Round logic and stake verification (network injected, unit-tested) |
| `server/main.ts` | HTTP server and the house account |

## Tests

```bash
npm test          # rules + house logic (fake chain)
npm run test:e2e  # live Testnet: loads extension/dist in Chromium, imports a fresh
                  # wallet, funds it, connects, plays 3 rounds approving each stake
```

`SHOTS=<dir> npm run test:e2e` saves screenshots of the game and each Noir approval window.

This is a demo of the integration, not a casino: the house is a single
server key, rounds live in memory, and it only runs on Testnet.
