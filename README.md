# 📌 Notes To The World (NTTW)

**A permanent, fully on-chain corkboard — where every sticky note is an ERC-721 — whose weekly
prize pool is settled cross-chain by Chainlink CCIP + VRF.**

Live on **two chains at once**: notes live on **Robinhood Chain** (4663); the randomness engine
lives on **Base** (8453) and ships every epoch's winning word back over **Chainlink CCIP**.

- Every stamped note is a real on-chain `string` (≤280 bytes, validated UTF-8) — no IPFS.
- Every stamp costs **1000 NOTES**: **500 burned** to `0x…dEaD`, **500 pooled** for that epoch.
- Every stamp is a lottery ticket. When the 7-day epoch ends, the pool is paid to **one**
  winner, chosen by a **Chainlink VRF v2.5** word that crosses the chain boundary via CCIP.

> Live status: both contracts deployed and wired; CCIP is verified two-way live on mainnets;
> the VRF request path is exercised live and currently pending on Chainlink's fulfiller —
> details in §6 (Verification & live tests).

---

## 1 · Why it's different

| Problem in typical on-chain lotteries | NTTW answer |
| --- | --- |
| Randomness from blockhash (miner-controllable) | Verifiable VRF v2.5 word, request made by an **ownerless relay**, not the game contract |
| Off-chain files pretend to be on-chain | Notes are stored **in the ERC-721 itself**; the NFT *is* the note |
| Admin keys everywhere | Admin surface is **one call, globally**: `setRelay()`, once. After that: no owner, no pause, no upgrades |
| Prize logic duplicated across chains | No logic crosses the chain — only **one integer**: the raw `randomWord`. The wall derives the winner alone |
| "It works in our tests" | Cross-chain behavior was debugged **live against real Chainlink networks** and each failure mode is documented (§6) |

---

## 2 · Contract-by-contract: what makes each one unique

### `IMDRetroWall.sol` — the wall (Robinhood Chain, ERC-721)
1. **Notes are first-class on-chain data.** Minted as ERC-721 tokens whose content lives in
   contract storage, pinned to an X/Y cell of a virtual cork canvas.
2. **Epoch ledger with a real fee market.** `requestSettlement(epoch)` is payable and pays the
   *quoted* CCIP fee; overpayment is returned in one transaction. The fee is discovered from the
   `InsufficientFee` revert — no off-chain quoting needed, no fee oracle.
3. **Three-lock cross-chain receive.** `ccipReceive` verifies (a) `msg.sender == CCIP router`,
   (b) `sourceChainSelector == Base selector`, (c) decoded sender `== relay`. Forged, replayed
   or wrong-lane messages revert.
4. **Deliberately minimal admin surface.** `setRelay()` is callable **exactly once** by the
   deployer (emits `RelaySet`). After that the contract is immutable: no owner, no pause, no
   upgrade path, no reroll. Omnipotence was traded away on purpose.
5. **Failure is legible, not silent.** Empty epochs settle with `WinnerDrawn(epoch, 0, 0, 0)`;
   lost CCIP messages are retried after `SETTLEMENT_RETRY_DELAY = 1 day`; settled epochs can
   never be re-requested (`SettlementStatus.Requested/Settled` machine).
6. **Honest economics, no hidden rake.** 50% burn + 50% pool, `MAX_STAMPS_PER_EPOCH = 5`,
   `winnerIndex = randomWord % ticketCount` computed deterministically from the public word
   stored in the event.

### `VrfCcipRelay.sol` — the relay (Base)
1. **State-neutral by design.** It never selects, filters, or bias-checks anything: it maps
   `epoch → first random word that arrives`, forwards it, and forgets. All winner logic stays
   on the wall — so even a broken/rotten relay cannot change *who wins*, only *when*.
2. **The ERC-165 claim that makes CCIP actually work.** The CCIP off-ramp probes
   `supportsInterface(IAny2EVMMessageReceiver)` and, if it reverts or returns false, silently
   treats the message as a token-only transfer — dropping the payload while still marking the
   message SUCCESS. Claiming the interface here is **load-bearing**, and this exact failure was
   reproduced and fixed live (§6).
3. **Who-can-do-what is exhaustively enumerable:** VRF coordinator → `rawFulfillRandomWords`;
   CCIP router → `ccipReceive` (with chain + sender + epoch validation); **anyone** →
   `deliver(epoch)` for liveness after a top-up; **anyone** → `receive()` to fund CCIP fees.
   Nobody can set the wall, the coordinator, the key hash, or the subscription after deploy —
   they are `immutable`.
4. **First-word-wins duplicate protection.** If a retried settlement arrives after the word is
   already known, the relay immediately `_deliver`s the cached word instead of requesting VRF
   again — no double burn, no double fee, no second source of truth.
5. **Two independent funding rails.** VRF is paid from a **native-ETH** subscription (no LINK
   dependency), CCIP reply fees from relay ETH; each can be topped by anyone, neither can be
   misused by anyone.

### `contracts/testnet/IMDRetroWallShortEpoch.sol`
Same bytecode-level logic with `EPOCH_DURATION = 10 minutes`, used for the live cross-chain
rehearsal described in §6 — the reason the whole path could be tested on mainnet without
waiting 7 days.

### `contracts/mocks/` + `contracts/interfaces/`
`MockCCIPRouter` and `MockVRFCoordinator` implement the exact interfaces the real networks
use, so the hardhat suite exercises the *actual* CCIP/VRF interaction shapes (22 tests:
validation, stamp accounting, tickets and caps, CCIP send/receive paths, settlement and claims).
The Chainlink interfaces are minimal local copies — the full `@chainlink/contracts` package
pulls a git dependency pnpm blocks here, and the surface actually used is deliberately ~3
functions wide.

---


## 3 · Deployments (v3, verify-checked)

| Artifact | Chain | Address |
| --- | --- | --- |
| **IMDRetroWall v3** (wall, ERC-721) | Robinhood Chain (4663) | `0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110` |
| **VrfCcipRelay** (relay) | Base (8453) | `0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110` |
| NOTES payment token (existing ERC-20) | Robinhood Chain | `0x03b76ccf7cfeec5198c81c5844b88a78e68a6173` |
| IMDRetroWall v2 (superseded, separate state) | Robinhood Chain | `0x69A8143ecF33527FA8dBD2102AfCE5DE3B210BbE` |
| IMDRetroWall v1 (superseded) | Robinhood Chain | `0x515F8f72B62e22c957D34Ba87b312133eFcAC939` |

Both v3 contracts share one address. This is a CREATE-address coincidence (same deployer and
nonce on both chains), not a shared contract — `scripts/status.ts` reads code + wiring on each
chain independently. v2/v1 remain for history only; v2 notes do not migrate to v3.

External infrastructure:

| Item | Robinhood Chain | Base |
| --- | --- | --- |
| CCIP router | `0x06fC836cf9839B1cd891C440A0a45242DA6Ae1c9` | `0x881e3A65B4d4a04dD529061dd0071cf975F58bCD` |
| CCIP chain selector | `6180753054346818345` | `15971525489660198786` |
| VRF v2.5 coordinator | — | `0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634` |
| VRF key hash | — | 2 gwei `0x00b81b5a…`; 30 gwei `0xdc2f8767…` |

Funding at deploy: VRF subscription **0.0002 ETH** (native), relay **0.0002 ETH** for CCIP reply
fees — deliberately small; top up before depending on settlements (§5 readback:
`TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/status.ts --network robinhood`).

---

## 4 · How an epoch settles (end to end)

```
Robinhood Chain                                    Base
────────────────────                               ───────────────────────
requestSettlement(epoch)  ── CCIP (300k gas) ──▶  VrfCcipRelay.ccipReceive
pay quoted fee (refund excess)                     └▶ VRF v2.5 requestRandomWords
                                                     native payment, 1 word
                                                   …… Chainlink fulfiller …
VrfCcipRelay.deliver  ◀──── rawFulfillRandomWords ──┘
  (anyone can call)                                   epoch→word, first-wins
        │
        └── CCIP (300k gas) ──▶ wall.ccipReceive
                                 winnerIndex = word % ticketCount(epoch)
                                 prize credited, WinnerDrawn(…, randomWord)
                                 winner claims with claimReward()
```

Failure handling: no tickets → `WinnerDrawn(epoch,0,0,0)`; relay ETH low → the word is kept and
anyone re-delivers after top-up; lost message → re-request after 1 day; the VRF word is stored
in `WinnerDrawn` so every draw remains independently auditable forever.

---

## 5 · Trust model and known limitations

**Randomness is not produced on Robinhood Chain.** It comes from Chainlink VRF v2.5 on Base:

- **Chainlink VRF**: verifiable off-chain by the VRF proof (the wall trusts the relay for the
  proof parts but the word itself is the coordinator's).
- **The relay**: trusted to forward the word unchanged — and structured so it *cannot* choose,
  filter or mutate one (§2). It accepts randomness only from its immutable coordinator and only
  for requests it made, for the first time (subsequent words are ignored).
- **Chainlink CCIP**: the wall accepts messages only from its immutable router + selector +
  relay triple.

Accepted trade-offs: sybil is cost-linear (1000 NOTES per ticket), settlement is pull-based,
direct token transfers to the wall are untracked and unrecoverable, and a stalled
CCIP/VRF leg *delays* (never destroys) a prize — the epoch stays Requested and retryable.

---

## 6 · Verification status & live cross-chain tests

| Check | Status |
| --- | --- |
| `hardhat compile` (Solidity 0.8.20) | ✅ |
| `hardhat test` (22 tests incl. cross-chain paths vs. interface-faithful mocks) | ✅ |
| `tsc` strict (hardhat + frontend) | ✅ |
| `npm run build` (Next.js prod build, typecheck) | ✅ |
| Deployment + wiring read back on both chains (`wall.relay()`, relay `WALL()`, key hash, VRF consumer, subscription balance) | ✅ via `scripts/status.ts` |
| **CCIP wall → relay, live** | ✅ executed on mainnet; relay's `ccipReceive` verified invoked (on-chain trace) |
| **VRF request live** | ✅ `RandomWordsRequested` + on-chain commitment emitted |
| **VRF fulfillment → CCIP back → `WinnerDrawn`** | ⚠️ pending on Chainlink's fulfiller — not our plumbing (see below) |
| External audit | ❌ none |

### What the live rehearsal proved (2026-10-15, on 10-minute test walls)

Every step up to the VRF fulfiller was executed on real mainnets, including the
failure modes of *both* integration layers:

- **CCIP delivery requires an explicit `supportsInterface`** claim on the receiver: without it
  the off-ramp silently converts the message into a token-only transfer (payload lost, status
  still SUCCESS). Reproduced live, fixed, and verified by an on-chain trace of real Chainlink
  executor transactions (ERC-165 probes + `ccipReceive`).
- **Relay↔wall pairing is enforced strictly**: a relay bound to a different wall reverts with
  `UnexpectedSender`; the CCIP message moves to FAILED with an ABI-encoded revert reason —
  and because `setRelay()` is one-shot on the wall, a mismatched pair was re-deployed fresh
  instead of being hot-patched (by design).
- **The VRF leg**: `requestRandomWords` succeeds, emits `RandomWordsRequested`, and stores the
  commitment on-chain — but the Chainlink fulfiller did not pick up our requests for hours.
  Isolation probes (fresh subscription, direct EOA consumer, correctly tagged `ExtraArgsV1`,
  both gwei lanes, a byte-identical clone of a request that fulfilled for another party in
  1–2 blocks) all confirmed the stall is inside Chainlink's off-chain request selection —
  during the same window, fulfillments kept succeeding for a handful of long-running
  subscriptions at 1–2 block delays.

Consequences for this project: the pending requests carry **no on-chain timeout and no cost**;
when the fulfiller picks them up, the relay forwards the word automatically with its existing
CCIP ETH balance and the wall settles (`WinnerDrawn`). The production paths are:

1. **Wait/switch VRF fulfillment** — fund with LINK instead of native, or a lane/tier the
   Base fulfiller actually serves; confirm in the Chainlink sub manager and/or support.
2. **Second independent randomness source** (drand/commit–reveal) used only if VRF stalls
   beyond a deadline — keeping the VRF word as the primary source and the failure path honest.
3. **Keep the relay neutral** in both cases: first-word-wins per epoch remains valid no matter
   which source satisfies it (or it should be re-deployed with its own fresh-wall pair).

---

## 7 · Setup

```bash
npm install
npm run compile     # hardhat compile
npm test            # hardhat test
```

Hardhat scripts load `tsconfig.hardhat.json` (CommonJS). Set it first:
`export TS_NODE_PROJECT=tsconfig.hardhat.json`.

### Deploy (three stages)

```bash
cp .env.example .env
# DEPLOYER_PRIVATE_KEY: a throwaway, funded deployer. Never commit a funded key.

# 1. Wall on Robinhood Chain
PAYMENT_TOKEN=0x03b76ccf7cfeec5198c81c5844b88a78e68a6173 \
  npx hardhat run scripts/deploy.ts --network robinhood

# 2. Relay + VRF subscription on Base (needs WALL_ADDRESS from step 1)
WALL_ADDRESS=0x... npx hardhat run scripts/deploy-relay.ts --network base
#   VRF_KEY_HASH=<lane> VRF_SUB_ID=<id> RELAY_FEE_FUND_ETH=... VRF_SUB_FUND_ETH=...

# 3. Wire the wall to the relay — exactly once (needs RELAY_ADDRESS from step 2)
RELAY_ADDRESS=0x... npx hardhat run scripts/set-relay.ts --network robinhood
```

`deploy-relay.ts` creates a native-ETH VRF subscription (or reuses `VRF_SUB_ID`), deploys the
relay, adds it as a consumer, and funds CCIP reply fees. The key hash is env-selectable because
Chainlink lanes differ in fulfiller coverage (see §6).

### Frontend (`.env.local`)

```bash
NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS=0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110
NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=0x03b76ccf7cfeec5198c81c5844b88a78e68a6173
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=   # optional
```

Without the notes address the board runs in demo mode with stamping disabled.

```bash
npm run dev     # http://localhost:3000
npm run build   # production build (also typechecks)
```

Don't run `npm run build` while `npm run dev` is running (both use `.next/`).

---

## 8 · Frontend contract surface (v3)

The ABI in `src/lib/contract.ts` is hand-written and must match `contracts/IMDRetroWall.sol`.

- Writes: `stampNote`, `requestSettlement(epoch)` (payable, CCIP fee), `claimReward()`.
- Reads: `getTotalNotes`, `getNotes`, `getNote`, `currentEpoch`, `timeUntilEpochEnd`,
  `stampsInEpoch`, `ticketCount`, `ticketOf`, `epochPrize`, `settlementStatus`, `claimable`.
- Events: `NoteCreated`, `SettlementRequested`, `WinnerDrawn`, `RewardClaimed`, `RelaySet`.

The v2-era leaderboard and manual settlement functions no longer exist.

---

## 9 · Troubleshooting

| Symptom | Fix |
| --- | --- |
| "CONTRACT NOT SET" banner | Set `NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS` in `.env.local`, restart `npm run dev`. |
| Wallet on wrong chain | Switch to Robinhood Chain (4663). |
| Stamp reverts on the token transfer | Balance below 1000 NOTES, or the approval was revoked. Approve again. |
| Stamp reverts with `StampLimitReached` | The address already has 5 stamps in this epoch. |
| `requestSettlement` reverts `RelayNotSet` | `setRelay` (step 3) has not run. |
| `requestSettlement` reverts `SettlementPending` | A request is in flight. Wait for `SETTLEMENT_RETRY_DELAY` (1 day). |
| Epoch stuck in Requested | Check relay ETH balance (`InsufficientBalance`) and VRF subscription balance; top up. See §6 for the fulfiller-stall case. |
