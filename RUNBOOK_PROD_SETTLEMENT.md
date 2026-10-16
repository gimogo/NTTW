# RUNBOOK — Production settlement of epoch 1 (IMDRetroWall v3, redeployed pair)

Target: winner determination for the first production epoch of
`IMDRetroWall v3` (wall, Robinhood Chain 4663, `0x9550E4F888d1C084CB1C8E74677Da54109723EE3`).

Production pair redeployed 2026-10-16 (all steps executed and verified):
- Wall creation tx `0x96a95bb3593ddd496aa818960dc3b39e01b2118c2168691c9deb0504fd87dc7a`
  (Robinhood block 89,795,280, status 1).
- Relay creation tx `0x20c3ac0a0a55e25f9c53a14a9ce85c9c45f1c511f250892d72e036daa84a37a2`
  (Base block 52,668,264, status 1) — relay `0x887bbed753938087Ce61Ca768a358848177E6eaA`.
- `setRelay` tx `0x3b7bb3b490bbd12fc48496fca55c60b1455a4646f0df5f3af39bd11a2828b928` (status 1);
  wiring verified both ways (`wall.relay()` ⇄ `relay.WALL()`).
- `GENESIS = 1792124930` (2026-10-16 04:28:50 UTC), `EPOCH_DURATION = 3 days`.
- **Epoch 1 ends 2026-10-19 04:28:50 UTC** (`GENESIS + 259200` = ts `1792384130`).
- State at last read: 0 stamps/notes, `settlementStatus(1) = None` (no stamps yet; the first
  stamped note starts the epoch-1 tickets).
- ERC-165 on the relay verified on-chain: `supportsInterface(0x85572ffb) = true`,
  `supportsInterface(0xffffffff) = false` (returns false, never reverts).
- VRF sub `51441836222580451052993458818119349024779142164800689033215217746100047214776`
  (native, 0.0008 ETH, `reqCount = 0`), key hash 2 gwei
  `0x00b81b5a830cb0a4009fbd8904de511e28631e62ce5ad231373d3cdad373ccab`,
  consumer = production relay solely. Relay ETH balance 0.0005.

Superseded pair for history: `0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110` on both chains.
Its production relay was stale (3939 bytes, no ERC-165): the CCIP off-ramp silently converted
its data messages into token-only no-ops (reproduced live on test pair w1/r1, message
`0x19cc5158fa9b7262606611dff5ec4d198180036dda78e5644d7b990b24826d29`). It can never settle;
the old wall's 500-NOTES epoch-1 pool is stranded (no sweep function). Do not touch it.

## T-1 day — preflight checklist (all read-only)

```bash
cd /home && export TS_NODE_PROJECT=tsconfig.hardhat.json

# 1. Wiring + code check (abort if any line mismatches)
npx hardhat run scripts/status.ts --network robinhood
# 2. Bytecode sanity: must contain the ERC-165 selector
cast code --rpc-url https://mainnet.base.org 0x887bbed753938087Ce61Ca768a358848177E6eaA | grep -c 01ffc9a7 # expect >= 1
# (find this assertion automated in scripts/settle-prod.ts preflight step 0)
# 3. Relay + subscription funding
cast balance --rpc-url https://mainnet.base.org 0x887bbed753938087Ce61Ca768a358848177E6eaA
cast call --rpc-url https://mainnet.base.org 0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634 \
  "getSubscription(uint256)(uint96,uint96,uint64,address,address[])" \
  51441836222580451052993458818119349024779142164800689033215217746100047214776
# 4. Wallet gas budget (needs >= fee quote + 0.00002 operating margin)
cast balance --rpc-url https://rpc.mainnet.chain.robinhood.com 0x380fbF99A903253E14b9EB797807B4B92cd4b019
```

Funding targets at the time of writing (per observed rehearsal costs):
- Relay: keep ≥ 0.0005 ETH on Base (one CCIP reply leg quoted ≈ 0.000066 ETH; ~7 legs margin).
- VRF subscription: 0.0008 ETH native covers the first word(s); top-ups are permissionless.
- Wall request (wallet-side): the exact CCIP fee is discovered at send time; budget ≥ 0.0001 ETH
  on Robinhood for the wall→relay leg (`requestSettlement`), typically ~0.000045 + gas.

## T-0 — settle epoch 1 (2026-10-19, any time after 04:28:50 UTC)

Runner: `scripts/settle-prod.ts` (preflights included; aborts before sending if any check fails).

```bash
cd /home && export TS_NODE_PROJECT=tsconfig.hardhat.json
PROD_WALL_ADDRESS=0x9550E4F888d1C084CB1C8E74677Da54109723EE3 \
PROD_RELAY_ADDRESS=0x887bbed753938087Ce61Ca768a358848177E6eaA \
npx hardhat run scripts/settle-prod.ts --network robinhood 2>&1 | tee /tmp/prod-settle.log
```

What it does, in order:
1. Preflight wiring both ways + relay ERC-165 capability (FATAL abort if stale).
2. Waits for `currentEpoch() >= 2` (epoch 1 truly ended).
3. Reads the exact CCIP fee via the `InsufficientFee` revert of a zero-value `staticCall`
   (no oracle, no off-chain quoting).
4. Sends `requestSettlement(1)` paying exactly the quoted fee (excess is refunded by the wall).
5. Monitors both chains for up to 24 h: relay `RandomnessRequested`/`randomnessReady(1)`/
   `delivered(1)`, then `WinnerDrawn` on the wall. Prints every state change with timestamps.

## After WinnerDrawn

- The full raw VRF word is stored in the `WinnerDrawn` event, auditable forever.
- Prize moves to `claimable[winner]` on the wall; winner pulls it with `claimReward()`.

## Contingencies

| Symptom | Cause | Action |
| --- | --- | --- |
| Preflight aborts at step 0 (no `01ffc9a7`) | Stale/wrong relay bytecode | Must not happen on this pair (verified 2026-10-16). If it does: stop, do not send. |
| `requestSettlement` reverts `RelayNotSet` | wiring broken | `setRelay` already used (tx `0x3b7bb3b4…2828b928`); a mismatch means the wrong wall address — stop. |
| `SettlementPending` before 2026-10-20 04:28:51 UTC | 1-day retry guard (only applies if the first request lands) | wait for `settlementRequestedAt(1) + 1 day`. |
| Message marked SUCCESS in CCIP but no `RandomnessRequested` on the relay | silent token-only conversion (stale relay) | abort; verify you are on relay `0x887bbed7…6eaA`, not the superseded pair. |
| Word arrives but wall says `InsufficientBalance` on deliver | relay ETH spent | top up relay; relay's `deliver(1)` is permissionless. |
| VRF fulfillment stalls (long) | Chainlink fulfiller selection | keep the requestIds + support ticket text (prepared 2026-10-16, test pairs r2/r4 evidence) and retry after `SETTLEMENT_RETRY_DELAY = 1 day`. |

## Do-not-execute notice

`scripts/settle-prod.ts` has NOT been executed against the redeployed pair. Epoch 1 settles
only after it ends at 2026-10-19 04:28:50 UTC. No transaction may be sent to the superseded
pair (`0xbD4808f0…2110`).

## Explorer source verification inputs

Files prepared for Standard-JSON verification:
- `verification/wall-standard-json-input.json` → upload to RobinScan for `IMDRetroWall`
  at `0x9550E4F888d1C084CB1C8E74677Da54109723EE3`.
- `verification/relay-standard-json-input.json` → upload to Basescan for `VrfCcipRelay`
  at `0x887bbed753938087Ce61Ca768a358848177E6eaA`.
Settings inside the JSON are solc 0.8.20, optimizer on (200 runs), EVM version paris.
