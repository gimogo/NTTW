# 📌 Notes To The World (NTTW)

**A permanent, fully on-chain corkboard — where every sticky note is an ERC-721 — whose
per-epoch prize pool (3-day epochs on the production pair) is settled cross-chain by
Chainlink CCIP + VRF.**

Live on **two chains at once**: notes live on **Robinhood Chain** (4663); the randomness engine
lives on **Base** (8453) and ships every epoch's winning word back over **Chainlink CCIP**.

- **Live app:** [nttw-blush.vercel.app](https://nttw-blush.vercel.app/) — points at the
  redeployed production wall.
- **Submitted on IMD Radar:** 2026-10-20 (the submitted About text is `ENTRY_RADAR.txt`).
- **Ticket transparency:** every ticket so far comes from the deployer wallet (`0x380fbF99…b019`) —
  the first production stamp tx is
  [`0xc6341f2e…09269b36`](https://robin.etherscan.io/tx/0xc6341f2e928f2b6b315a3f2fa911a59b59e62726c40f5e6246f3c82109269b36)
  (block 89837366); epoch 1 (settled 2026-10-19, §6) held exactly that 1 ticket — its 500 NOTES
  pool was drawn and paid out; epoch 2 is live until 2026-10-22 04:28:50 UTC.

- Every stamped note is a real on-chain `string` (≤280 bytes, validated UTF-8) — no IPFS.
- Every stamp costs **1000 NOTES**: **500 burned** to `0x…dEaD`, **500 pooled** for that epoch.
- Every stamp is a lottery ticket. When the epoch ends (3 days on the production wall,
  genesis-based), the pool is paid to **one** winner, chosen by a **Chainlink VRF v2.5** word
  that crosses the chain boundary via CCIP.

> Live status: both contracts deployed and wired. The production pair was **re-deployed on
> 2026-10-16** because the first production relay lacked the ERC-165 claim the CCIP off-ramp
> probes for, and could never request VRF (details in §3 and §6). The new pair is verified
> on-chain: ERC-165 claimed, runtime bytecode equals the compiled artifact, wiring read back
> both ways. Epochs are **3 days** on the production wall; epoch 1 ended 2026-10-19 and is settled
> end-to-end (§6); epoch 2 ends 2026-10-22 04:28:50 UTC.

---

## 1 · Why it's different

| Problem in typical on-chain lotteries | NTTW answer |
| --- | --- |
| Randomness from blockhash (miner-controllable) | Verifiable VRF v2.5 word, request made by an **immutable relay**, not the game contract |
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
4. **First-word-wins duplicate protection — with an honest limit.** If a retried settlement
   arrives while the word is known but never been handed to the router, the relay `deliver`s the
   cached word instead of paying for a fresh VRF request. Once a reply *has* been handed to the
   router (`delivered[epoch] = true`), the relay stays deliberately silent: the wall's 1-day
   re-request then cannot recover a stuck reply and only burns the caller's fee (audit finding
   #1). Recovery in that case is the CCIP-Explorer manual execution of the original message
   (§6), which is safe because the wall rejects duplicates with `EpochAlreadySettled`.
5. **Two independent funding rails.** VRF is paid from a **native-ETH** subscription (no LINK
   dependency), CCIP reply fees from relay ETH; each can be topped by anyone, neither can be
   misused by anyone.

### `contracts/testnet/IMDRetroWallShortEpoch.sol`
Same bytecode-level logic with `EPOCH_DURATION = 10 minutes`, used for the live cross-chain
rehearsal described in §6 — the reason the whole path could be tested on mainnet without
waiting a production-length epoch.

### `contracts/mocks/` + `contracts/interfaces/`
`MockCCIPRouter` and `MockVRFCoordinator` implement the exact interfaces the real networks
use, so the hardhat suite exercises the *actual* CCIP/VRF interaction shapes (22 tests:
validation, stamp accounting, tickets and caps, CCIP send/receive paths, settlement and claims).
The Chainlink interfaces are minimal local copies — the full `@chainlink/contracts` package
pulls a git dependency pnpm blocks here, and the surface actually used is deliberately ~3
functions wide.

### The NOTES token and the Uniswap V4 pool (external infrastructure, not NTTW code)

The wall's payment token, **NOTES**, was launched through the **IMD Protocol** as a Uniswap
**V4** pool against IMD. This is launch infrastructure we consume — not our custom code — and
is listed here so judges can verify the token side independently:

| Item | Value |
| --- | --- |
| NOTES ERC-20 (18 decimals, 1,000,000,000 supply, no callable mint/burn) | `0x03b76ccf7cfeec5198c81c5844b88a78e68a6173` (Robinhood Chain 4663) — verified on [RobinScan](https://robin.etherscan.io/token/0x03b76ccf7cfeec5198c81c5844b88a78e68a6173) |
| Pool | NOTES / IMD (`0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127`), fee 12,500 (1.25%), tickSpacing 60, Uniswap V4 PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| poolId | `0x27c60c8dcaf32a6bc17e1d54e9eddf194d5d5319adbacf2ebb89023be1e95b80` |
| Launch transaction (mint + Initialize + pool seeding, block 89,350,492) | [`0x874397f3de80109a73ca8bae153efb7a9005cb73f8c271055f679b455fdc55f2`](https://robin.etherscan.io/tx/0x874397f3de80109a73ca8bae153efb7a9005cb73f8c271055f679b455fdc55f2) |
| Launch hook | `PoolInitializationGuard` at `0x19Bec7C2E1b2aadAf67b259744751a9960d66000` (verified source) |
| What the hook does | Only implements `beforeInitialize`: it reverts with `NotFactoryInitialization` unless the pool is initialized by the IMD launch factory — i.e. it gates who can create/initialize the pool. It takes no fees, adds no limits, and does not touch swaps or liquidity |
| Launch records | Project: [github.com/identity-md-launches/launch-1866-notes](https://github.com/identity-md-launches/launch-1866-notes); distributor (10% agents): `0xd89c2f7745d28c9c5e5466781c5a14be1f4fe9f3` |

Distribution at launch: 88% as pool liquidity, 880,000,000 NOTES now sit in the V4 PoolManager
(read back via `balanceOf`), 10% to 409 agent wallets via the Merkle distributor, 2% to the
requester. **Hook ≠ our code**: `PoolInitializationGuard` is IMD's standard launch hook; NTTW's
custom logic is the wall + relay pair described in §2.

---


## 3 · Deployments (v3, verify-checked)

**Current production pair — re-deployed from current fixed source on 2026-10-16:**

| Artifact | Chain | Address |
| --- | --- | --- |
| **IMDRetroWall v3** (wall, ERC-721) | Robinhood Chain (4663) | `0x9550E4F888d1C084CB1C8E74677Da54109723EE3` |
| **VrfCcipRelay** (relay) | Base (8453) | `0x887bbed753938087Ce61Ca768a358848177E6eaA` |
| NOTES payment token (existing ERC-20) | Robinhood Chain | `0x03b76ccf7cfeec5198c81c5844b88a78e68a6173` |

Production redeploy evidence (all read back on-chain 2026-10-16):

| Item | Value |
| --- | --- |
| Wall creation tx | `0x96a95bb3593ddd496aa818960dc3b39e01b2118c2168691c9deb0504fd87dc7a` (Robinhood block 89,795,280, status 1) |
| Relay creation tx | `0x20c3ac0a0a55e25f9c53a14a9ce85c9c45f1c511f250892d72e036daa84a37a2` (Base block 52,668,264, status 1) |
| `setRelay` wiring tx | `0x3b7bb3b490bbd12fc48496fca55c60b1455a4646f0df5f3af39bd11a2828b928` (status 1; `wall.relay()` ⇄ `relay.WALL()` verified both ways) |
| `GENESIS` / epoch length | `1792124930` (2026-10-16 04:28:50 UTC) / **3 days** → epoch 1 ends **2026-10-19 04:28:50 UTC** |
| ERC-165 on relay | `supportsInterface(0x85572ffb) = true`, `supportsInterface(0xffffffff) = false` (false, never reverts) |
| Bytecode equality vs compiled artifact | wall: 19,431 bytes, diffs confined to 16 immutable windows (5 immutables); relay: 4,073 bytes, diffs confined to 18 immutable windows (6 immutables); every window holds the expected constructor value |

**Superseded production pair (kept for history, must never be touched):**

| Artifact | Chain | Address |
| --- | --- | --- |
| IMDRetroWall v3 (superseded) | Robinhood Chain | `0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110` |
| VrfCcipRelay (superseded) | Base | `0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110` |
| IMDRetroWall v2 (superseded, separate state) | Robinhood Chain | `0x69A8143ecF33527FA8dBD2102AfCE5DE3B210BbE` |
| IMDRetroWall v1 (superseded) | Robinhood Chain | `0x515F8f72B62e22c957D34Ba87b312133eFcAC939` |

The superseded production relay **lacks ERC-165**, so the CCIP off-ramp silently converted its
messages to token-only no-ops — the old production path could never request VRF. Therefore the
pair was redeployed fresh (2026-10-16): the orphaned old-wall epoch-1 pool (500 NOTES from the
single stamp there) is stranded inside the superseded wall — it has no sweep function and is
disclosed here rather than hidden. v2/v1 remain for history only; v2 notes do not migrate to v3.

**Epoch-length discrepancy in the source comments (audit #7):** the NatSpec/header comments of
the explorer-verified wall source still say *7 days*, but the deployed constant is **3 days** —
read from the chain: `EPOCH_DURATION() = 259200 s`, `GENESIS = 1792124930`. Always trust the
on-chain constant: epoch 1 ends **2026-10-19 04:28:50 UTC**, not the NatSpec implied date.
The contract files are frozen for this submission; the discrepancy is documented rather than
edited.

External infrastructure:

| Item | Robinhood Chain | Base |
| --- | --- | --- |
| CCIP router | `0x06fC836cf9839B1cd891C440A0a45242DA6Ae1c9` | `0x881e3A65B4d4a04dD529061dd0071cf975F58bCD` |
| CCIP chain selector | `6180753054346818345` | `15971525489660198786` |
| VRF v2.5 coordinator | — | `0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634` |
| VRF key hash | — | 2 gwei `0x00b81b5a…`; 30 gwei `0xdc2f8767…` |

**Explorer source-verification status (read from the explorers 2026-10-16 07:13 UTC):**
Basescan still shows the production relay **`Contract: Unverified`**; the RobinScan page is not
machine-readable from this repo's tooling (treat it as unverified until confirmed). The
Standard-JSON inputs are prepared and committed under `verification/` and are byte-for-byte
the input of the deployed pair — upload them (wall → RobinScan, relay → Basescan) before
submission so both pages read "Source Code Verified / Exact Match". The verified bundle also
includes `contracts/testnet/IMDRetroWallShortEpoch.sol`, which is source-verified but **not
deployed** on any chain (§2). Our own byte-level proof
(§3 evidence table) already equals the deployed bytecode.

Funding at deploy (2026-10-16 pair): VRF subscription **0.0008 ETH** (native, sub id
`51441836222580451052993458818119349024779142164800689033215217746100047214776`, consumer = the
new relay, `reqCount = 0`), relay **0.0005 ETH** for CCIP reply fees (≈ 7 legs at the quoted
0.0000658 ETH per leg); top up before depending on settlements (§5 readback:
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
anyone re-delivers after top-up (`deliver(epoch)` is permissionless); VRF word known but the
reply leg stuck → `deliver(epoch)` on Base if not yet delivered, otherwise **CCIP Explorer
manual execution** of the original reply message — never a re-request inside the pending window
(audit #1/#4); VRF word not yet known → wait for Chainlink fulfillment. The VRF word is stored
in `WinnerDrawn` so every draw remains independently auditable forever.

> **The relay does NOT forward the word automatically.** After `rawFulfillRandomWords` records
> it, exactly one explicit action moves it: someone must call `deliver(epoch)` on Base, or the
> wall must execute an accepted CCIP message. The exact end-to-end sequence is documented in §6.

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
CCIP/VRF leg *delays* a prize — the epoch stays Requested and recovery is a manual,
permissionless `deliver()` on Base or a CCIP-Explorer manual execution, **never** a second
`requestSettlement` inside the 1-day retry window (that path costs the caller its fee and does
not move the word, §6 + audit #1). If no recovery step is taken, the prize stays locked (no
sweep) — §10 lists the recovery and liveness trust assumptions in full.

---

## 6 · Verification status & live cross-chain tests

| Check | Status |
| --- | --- |
| `hardhat compile` (Solidity 0.8.20) | ✅ |
| `hardhat test` (22 tests incl. cross-chain paths vs. interface-faithful mocks) | ✅ |
| `tsc` strict (hardhat + frontend) | ✅ |
| `npm run build` (Next.js prod build, typecheck) | ✅ |
| Deployment + wiring read back on both chains (`wall.relay()`, relay `WALL()`, key hash, VRF consumer, subscription balance) | ✅ via `scripts/status.ts` |
| **Production-relay ERC-165 probe (the exact check the superseded pair fails)** | ✅ `supportsInterface(0x85572ffb) = true`, `supportsInterface(0xffffffff) = false` (false, never reverts) |
| **Production bytecode equality vs compiled artifact** | ✅ wall 19,431 B / relay 4,073 B — all diffs inside immutable windows only |
| **Production wiring both ways** | ✅ `wall.relay()` = relay, `relay.WALL()` = wall, router/selector/key-hash/sub-id match deploy values |
| **CCIP wall → relay, live** | ✅ executed on mainnet; relay's `ccipReceive` verified invoked (on-chain trace) |
| **VRF request live** | ✅ `RandomWordsRequested` + on-chain commitment emitted |
| **VRF fulfillment → CCIP back → `WinnerDrawn`** | ✅ **executed live on the production pair, 2026-10-19** — full evidence and tx chain in "Epoch 1 settled in production" (below); the multi-hour stalls seen on the **test pairs (r2/r4)** are history (Chainlink's off-chain fulfiller selection) |
| [IMD audit](https://github.com/Identity-md/research/blob/main/jobs/16c65a39-24f4-47d6-a9f5-2140c70791c6/files/AUDIT.md) (commit `d063100`, earlier top-10-leaderboard design) | ⚠️ completed, but on the earlier design — see the audit-status note below; v3 has **not** been re-audited |

#### The two distinct on-chain failure causes (recorded 2026-10-16)

- **Superseded production pair — relay bytecode stale (fixed by redeploy).** The deployed relay
  of the old production pair (`0xbD4808f0…2110`) predates the ERC-165 fix: it cannot answer the
  off-ramp's `supportsInterface` probe, so every wall→relay data message is executed as a
  token-only no-op (CCIP still reports SUCCESS). No VRF request ever reached the coordinator
  from that relay — witnessed on-chain by w1's message SUCCESS with zero receiver activity, and
  by w3's `UnexpectedSender` FAILURE (relay bound to a different wall). Resolution: fresh pair
  redeploy on 2026-10-16 (§3).
- **Test pairs (r2/r4) — VRF fulfiller stall (historical).** These relays are correct (ERC-165 claimed,
  `ccipReceive` verified by on-chain trace, two VRF requests committed on-chain), but the
  requests were pending for many hours — an off-chain Chainlink fulfiller-selection issue, not
  our plumbing. Evidence: sub `554014898…679128` `pendingRequestExists = true`, plus three probe
  requests on sub `693592238…789700`; support-ticket text was prepared on 2026-10-16. The
  production pair itself fulfilled within minutes on 2026-10-19 (see "Epoch 1 settled in
  production" above), so the stall is treated as lane history, not an open issue on our pair.

#### Audit status (honest)

The IMD security audit covered commit `d063100` — the earlier design with a top-10 leaderboard.
It found 2 medium, 7 low and 5 info findings. Against the current v3 code:

- **Fixed in v3** (design change or code fix, with evidence in `FACTS.md` §7): pull-based single-winner
  payout replaces the push-loop leaderboard (`claimable[winner] += prize` + `claimReward()`,
  `IMDRetroWall.sol:439-451`); strict `#RRGGBB` color validation (`IMDRetroWall.sol:682-697`);
  strict RFC 3629 UTF-8 validation (`IMDRetroWall.sol:699-751`); base64-encoded `tokenURI` (no raw `#`);
  `getNotes` bounds panic removed (`IMDRetroWall.sol:502`); genesis-based epochs (no lazy rollover);
  `@openzeppelin/contracts` in `package.json`; `TextEncoder().encode()` byte-length in the composer
  (`src/components/NoteComposer.tsx:97-98`); `InvalidTokenDecimals` check in the constructor
  (`IMDRetroWall.sol:284-285`); NatSpec/constant drift fixed.
- **Not applicable in v3**: the tested push-loop failure path no longer exists in any form.
- **Still open / by design**: direct token transfers to the wall are untracked and unrecoverable
  (no sweep function); this is documented in §5.

**v3 itself has not been re-audited.** "Fixed" above means verified against v3 source during this
project's own inspection — not a second audit. For judging purposes, treat the audit as covering the
superseded `d063100` design.

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

Consequences for this project: fulfillment on a pending request carries **no on-chain timeout
and no cost**, but it also does **not** auto-settle anything — the relay only records the word.
The exact 4-step production sequence (`scripts/settle-prod.ts` implements 1–3; step 4 happens
on the winner's wallet):

1. **`requestSettlement(1)`** — once, paying the quoted CCIP fee. NEVER re-request while
   pending: inside `SETTLEMENT_RETRY_DELAY` (1 day) the wall reverts `SettlementPending`, and
   after that window a re-request spawns an **additional paid VRF request** for the same epoch
   (audit #4) — the first word wins and the extra one drains the subscription.
2. **Wait for `relay.randomnessReady(1)` = true** — Chainlink's fulfiller lane does the work;
   multi-hour stalls **were** observed on the test pairs (fulfiller selection, not our plumbing);
   the production pair fulfilled in ~15 minutes on 2026-10-19.
3. **`relay.deliver(1)` on Base** — a separate, permissionless transaction anyone can send
   (gas from the sender, the CCIP reply fee from the relay's own ETH balance). The settlement
   script sends it automatically once the word is ready; `deliver()` alone was missing from the
   original tooling (audit #6).
4. **`WinnerDrawn` lands on the wall; the winner calls `claimReward()`** themselves.

Fallback for a stuck reply leg: if `relay.delivered(1)` is already true while the wall remains
`Requested`, the reply message was handed to the router but never executed on the wall. Finish
it via **CCIP Explorer** (`https://ccip.chain.link`): open the Base→Robinhood message
(`RandomnessDelivered` carries the messageId), press **Manually Execute**. Re-execution is safe
— the wall rejects a duplicate word with `EpochAlreadySettled`. Do **not** `requestSettlement`
again for a stuck-but-delivered epoch (audit #1: the relay's retry branch is a silent no-op
then; only off-contract manual execution completes it).

#### Epoch 1 settled in production (2026-10-19) — the first end-to-end run, all 4 steps + payout

| Step | Evidence (full hash, block, chain) |
| --- | --- |
| 1. `requestSettlement(1)`, CCIP fee quoted 0.000045246852418097 ETH | tx `0x48acb5d25994c00a6fbd9aa42e3fab9e5091bfe28984a15e6df73790be1318c3`, block 92340439, Robinhood 4663 |
| 2. VRF fulfilled; word recorded on the immutable relay (`randomnessReady(1) = true`) | VRF sub `51444126…00047214776`, sub proof on-chain; word below |
| 3. `relay.deliver(1)` on Base (permissionless, once) | tx `0xae51fa85889890b3f8a71e7588385d7b72f68404f524dc6dd0204daa78e02a18`, Base block 52798101; CCIP reply messageId `0xdc53ec33dcf320dc3014c622c65186624b1abfa1cc7b978dbe4c3e1a3a5feb2d` (not needed — the leg executed on its own ~24 min later) |
| 4. `WinnerDrawn` on the wall | tx `0xe1adfc7478a3f265624e8968343cb7edeb172cddb59eec2e404636c91156d385`, block 92362088: winner `0x380fbF99A903253E14b9EB797807B4B92cd4b019`, prize 500 NOTES, stored word `10824310925582213203571677487811418395102277655736429366599786138850914746510` |
| Payout (pull-based, `claimReward()` from the winner's wallet) | tx `0x3fd67e3fc76afdd8674141f6d6472aedb32c1e32278555dbb5a2f69a82a94b43`, block 92371327: `claimable` 500 → 0; winner's NOTES balance +exactly 500 NOTES |

Honest scope: epoch 1 held exactly **1 ticket, from the deployer wallet**, so the winner was
defined as the words chosen by deterministic construction, not by chance. What the run proves is
the **end-to-end production path** — requestSettlement → CCIP → immutable-relay VRF v2.5
fulfillment → CCIP reply → `winnerIndex = word % 1 = 0` credit on the immutable wall — not
lottery fairness. Sybil resistance / fairness across many tickets becomes measurable from
epoch 2 onward (live now, ends 2026-10-22 04:28:50 UTC).

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
NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS=0x9550E4F888d1C084CB1C8E74677Da54109723EE3
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
| Epoch stuck in Requested | Check relay ETH balance (`InsufficientBalance`) and VRF subscription balance; top up. Then §6: `deliver(1)` on Base when the word is ready, or CCIP Explorer for a stuck reply. NEVER re-request inside the 1-day window. |

---

## 10 · Audit status (2026-10-16)

The production pair at commit `a5c1af9fc13c8413b508b245a997fdfc2689fa81` was audited by four
specialized audit agents plus a judge on the IdentityMD network.
Report: **[AUDIT.md — job 44df6543-f9d6-4f44-9d69-40e0f7223b0c](https://github.com/Identity-md/research/blob/main/jobs/44df6543-f9d6-4f44-9d69-40e0f7223b0c/files/AUDIT.md)** —
**2 medium, 5 low, 2 info**. Nothing in the report was fixed by editing the deployed contracts
(they are frozen for this submission); each finding is **acknowledged, not fixed in the
deployed contracts**, with the operational mitigation below. The earlier audit of the
superseded `d063100` design remains in §6 as history.

| # | Finding (severity) | Mitigation (operational only) |
| --- | --- | --- |
| 1 | Relay never re-sends a cached word once `delivered[epoch]` is set — the wall's 1-day re-request cannot recover a sent-but-unexecuted reply and only burns the caller's fee (medium) | Never re-request a pending epoch. If `delivered(1)=true` and the wall is Requested, finish via CCIP Explorer **Manually Execute** (safe: the wall rejects duplicates with `EpochAlreadySettled`). Documented in §6 and the runbook. |
| 2 | Settlement liveness depends on the externally-owned VRF subscription and immutable Chainlink parameters — cancelling it, removing the consumer, or a retired lane strands every pool while stamping keeps charging (medium) | Trust assumption (below): the subscription owner is a **trusted liveness role** — must never cancel or remove the consumer; keep the sub funded; monitor lane coverage. No on-chain fix without redeploy. |
| 3 | `CCIP_GAS_LIMIT = 300_000` leaves the relay's cached-word CCIP branch only ~4.7k gas of headroom (measured 295,318 / 300,000 on the live lane) (low) | If Chainlink's on-ramp cost ever rises above the budget, recovery still works via CCIP Explorer manual execution (off-ramp gas override is caller-side). Watch lane upgrades. |
| 4 | Re-requests while VRF is pending spawn additional paid VRF requests for the same epoch; only the first word is used and the rest drain the subscription (low) | Hard rule in §4/§6, the runbook, and `scripts/settle-prod.ts`: the script sends `requestSettlement` at most once and never within the retry window; delivery is a separate permissionless `deliver(1)`. |
| 5 | Wall `ccipReceive` accepts a word for an epoch in state `None`, so a relay-side fault could settle a running epoch and strand later pools (low) | Defense-in-depth gap, accepted: the production relay is bound one-shot to the audited pair (wiring + bytecode verified, §3), only echoes epochs the wall requested. No redeploy for this submission. |
| 6 | `scripts/settle-prod.ts` and README relied on an automatic word forward the contracts never perform — the script never called `relay.deliver()` (low) | Mitigation IS this release: the script now polls `randomnessReady(1)`, sends `relay.deliver(1)` on Base once ready, surfaces the messageId + CCIP Explorer fallback, and never re-requests; README §6 and the runbook now state that delivery is an explicit, separate call. |
| 7 | NatSpec / header / older docs say 7 days while the deployed constant is 3 days, 259200 s (low) | Docs corrected this release (§3, §4, FACTS, ENTRY_RADAR). The contract files stay frozen; the discrepancy is documented and the on-chain constant is authoritative. |
| 8 | `stampNote` works before `setRelay`, so on a fresh deployment the deployer could pick the randomness source while money is at stake (info) | Deployment hygiene only: `setRelay(0x887bbed7…6eaA)` was executed (one-shot) **before** any production stamping; anyone can read `relay()` before stamping. Accepted for the live pair. |
| 9 | First-word-wins and `UnknownRequest` branches of `rawFulfillRandomWords` are not exercised by the hardhat suite (info) | Coverage gap documented; behavior verified by the auditors' scratch proofs (later word dropped). Test files intentionally unchanged in this submission. |

**Trust assumptions (read before trusting "immutable"):**

- The VRF subscription
  `51441836222580451052993458818119349024779142164800689033215217746100047214776`
  is owned by the deployer wallet `0x380fbF99A903253E14b9EB797807B4B92cd4b019`. It **must never
  be cancelled and the relay must never be removed as its consumer** — either action strands
  every existing and future prize pool with no on-chain recovery (finding #2). The owner's only
  legitimate operations are top-ups and consumer re-add of the same relay address.
- Settlement liveness depends on **Chainlink fulfillment**: the wall pays the fee and then waits
  for the 2-gwei lane fulfiller to pick up the request. Multi-hour stalls were observed on the
  test pairs (§6); there is no on-chain timeout, cost, or automatic fallback beyond the manual
  steps in §6.
- CCIP lanes/routers are immutable per deployment; a stuck reply leg is finished via CCIP
  Explorer manual execution, not on-chain code (findings #1, #3).

**Current settlement status (updated 2026-10-19, after the epoch-1 settlement):** epoch 1 is
**Settled and fully paid out**: request tx `0x48acb5d2…18c3` (block 92340439) → VRF fulfilled →
deliver tx `0xae51fa85…2a18` (Base block 52798101) → `WinnerDrawn` tx `0xe1adfc74…d385`
(block 92362088, winner deployer wallet, 500 NOTES of the single-ticket pool) → claim tx
`0x3fd67e3f…4b43` (block 92371327, `claimable` zeroed). Full full-hash chain in §6.
Epoch 2 is live and ends **2026-10-22 04:28:50 UTC**. Honest note: epoch 1 had a single ticket
from the deployer wallet, so the winner was predetermined — this run proves the end-to-end
VRF → CCIP → wall path on production, not lottery fairness.

---

## 11 · How NTTW uses IMD (verifiable facts)

What NTTW takes from the IMD ecosystem, with a source for every claim (`FACTS.md` §2/§3/§4/§7,
the launch repo, RobinScan reads, and the two IMD audit reports):

1. **NOTES was launched through the IMD Protocol.** Launch tx
   [`0x874397f3…dc55f2`](https://robin.etherscan.io/tx/0x874397f3de80109a73ca8bae153efb7a9005cb73f8c271055f679b455fdc55f2)
   (Robinhood block 89,350,492) minted 1,000,000,000 NOTES and initialized the Uniswap **V4**
   NOTES/IMD pool. Per the launch page
   ([github.com/identity-md-launches/launch-1866-notes](https://github.com/identity-md-launches/launch-1866-notes))
   the split is **88% pool liquidity / 10% to 409 contributing agents / 2% to the requester**;
   the on-chain readbacks corroborate it: 880,000,000 NOTES (≈88%) sit in the V4 PoolManager
   `0x8366a39CC670B4001A1121B8F6A443A643e40951` and ≈99.8M NOTES (≈10%) in the agents' Merkle
   distributor `0xd89c2f7745d28c9c5e5466781c5a14be1f4fe9f3` (code live on-chain, 4,145 bytes).
2. **The pool hook is IMD's, not our code.** `PoolInitializationGuard`
   `0x19Bec7C2E1b2aadAf67b259744751a9960d66000` (RobinScan: verified exact match, Sol 0.8.26)
   implements only `beforeInitialize` and reverts with `NotFactoryInitialization` unless the IMD
   launch factory initializes the pool — launch infrastructure we consume, never an NTTW contract.
3. **Both audits were run by the IMD swarm.** Job
   [16c65a39](https://github.com/Identity-md/research/blob/main/jobs/16c65a39-24f4-47d6-a9f5-2140c70791c6/files/AUDIT.md)
   on commit `d063100` (the earlier top-10-leaderboard design, kept as history) and job
   [44df6543](https://github.com/Identity-md/research/blob/main/jobs/44df6543-f9d6-4f44-9d69-40e0f7223b0c/files/AUDIT.md)
   on commit `a5c1af9` (the current production pair; 2 medium, 5 low, 2 info — all findings
   acknowledged with operational mitigations, README §10).
4. **Every stamp moves IMD-launched supply.** The wall's payment token is NOTES, the IMD-launched
   token above; each stamp pays 1000 NOTES of which 500 burn to `0x…dEaD` and 500 pool as the
   epoch prize (`IMDRetroWall.sol:118,121,124,355-356`) — the fee sink and the prize pool are
   both drawn from IMD-launched NOTES.
5. **Our custom contracts call nothing of IMD after launch.** The contract sources contain no
   reference to the IMD token, the launch factory, the PoolManager, the hook, the distributor, or
   any IMD oracle/jobs (grep of `contracts/`: zero matches) — they touch only NOTES as a plain
   ERC-20, Chainlink CCIP (immutable router/selector/relay), and Chainlink VRF v2.5 (immutable
   coordinator/key hash/sub id). NTTW's novelty is the **cross-chain Chainlink VRF + CCIP winner
   settlement**, not the token or the launch mechanics.

