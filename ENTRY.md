# ENTRY.md — Notes To The World (NTTW)

Notes To The World is a permanent, fully on-chain corkboard where every sticky note is an
ERC-721 and each 3-day-epoch prize pool paid from 1000-NOTES stamp fees is settled cross-chain
by Chainlink VRF v2.5 delivered over Chainlink CCIP.

How it works:

- Stamping a note (<= 280 bytes UTF-8, stored in the NFT itself, no IPFS) costs 1000 NOTES
  paid atomically by the wall: 500 burned to 0x...dEaD, 500 pooled, and the stamp is a
  ticket (IMDRetroWall.sol:355-356, :118).
- Epochs are genesis-based windows (3 days on the production wall redeployed 2026-10-16;
  IMDRetroWall.sol:134); max 5 tickets per address per epoch (MAX_STAMPS_PER_EPOCH, :137).
- At epoch end, anyone calls requestSettlement(epoch) and pays the exact CCIP fee; the wall
  forwards one integer (the epoch) to an immutable VrfCcipRelay on Base, which requests one
  Chainlink VRF v2.5 word. The word is NOT forwarded automatically: once the relay records it
  (randomnessReady(epoch) = true), anyone calls deliver(epoch) on Base (permissionless) to ship
  it back over CCIP; if the reply leg stalls, CCIP Explorer manual execution finishes it.
  requestSettlement is NEVER repeated while pending (the wall reverts SettlementPending inside
  the 1-day window, and a later re-request buys an extra VRF word that is discarded).
- The wall computes winnerIndex = word % ticketCount (IMDRetroWall.sol:437), stores the raw
  word in WinnerDrawn (auditable forever), and credits the pool pull-based: the winner calls
  claimReward() (:439-451); no tickets settle as WinnerDrawn(epoch,0,0,0).

Why this is more than a standard token: the wall + relay is custom Solidity on two chains
(Robinhood 4663 + Base 8453). The relay is state-neutral — it cannot choose, filter or
mutate a word, only forward the first one. The wall accepts CCIP messages only on an
immutable router/selector/relay triple, has one one-shot setRelay() admin call, and no
owner, pause or upgrade. Randomness and prize logic live on separate chains by design.
The NOTES payment token itself is external infrastructure: it was launched through the IMD
Protocol as a Uniswap V4 pool against IMD, so its market exists on-chain from day one.

Verify it yourself:

| What | Chain | Link / address |
| --- | --- | --- |
| IMDRetroWall v3 (wall, ERC-721) — production pair, redeployed 2026-10-16 | Robinhood 4663 | https://robin.etherscan.io/address/0x9550E4F888d1C084CB1C8E74677Da54109723EE3 |
| VrfCcipRelay (production pair, redeployed 2026-10-16) | Base 8453 | https://basescan.org/address/0x887bbed753938087Ce61Ca768a358848177E6eaA |
| Production `setRelay` wiring tx (one-shot) | Robinhood 4663 | https://robin.etherscan.io/tx/0x3b7bb3b490bbd12fc48496fca55c60b1455a4646f0df5f3af39bd11a2828b928 |
| **Live production stamp — the first ticket of epoch 1** (all tickets so far come from the deployer wallet) | Robinhood 4663 | https://robin.etherscan.io/tx/0xc6341f2e928f2b6b315a3f2fa911a59b59e62726c40f5e6246f3c82109269b36 (block 89,837,366; ticket pool = 500 NOTES) |
| Live app (points at the redeployed production wall) | Robinhood 4663 | https://nttw-blush.vercel.app/ |
| **Epoch-1 settlement, step 1: `requestSettlement(1)` (CCIP fee quoted, paid once)** | Robinhood 4663 | https://robin.etherscan.io/tx/0x48acb5d25994c00a6fbd9aa42e3fab9e5091bfe28984a15e6df73790be1318c3 (block 92340439) |
| **Epoch-1 settlement, step 2: VRF word fulfilled on the immutable relay (`randomnessReady(1)`)** | Base 8453 | stored word `10824310925582213203571677487811418395102277655736429366599786138850914746510` |
| **Epoch-1 settlement, step 3: `deliver(1)` on Base (permissionless, once) + CCIP reply messageId** | Base 8453 | https://basescan.org/tx/0xae51fa85889890b3f8a71e7588385d7b72f68404f524dc6dd0204daa78e02a18 (block 52798101; messageId `0xdc53ec33dcf320dc3014c622c65186624b1abfa1cc7b978dbe4c3e1a3a5feb2d`) |
| **Epoch-1 settlement, step 4: `WinnerDrawn` on the wall — first production prize** | Robinhood 4663 | https://robin.etherscan.io/tx/0xe1adfc7478a3f265624e8968343cb7edeb172cddb59eec2e404636c91156d385 (block 92362088; prize 500 NOTES) |
| **Epoch-1 payout: `claimReward()` from the winner's wallet (pull-based)** | Robinhood 4663 | https://robin.etherscan.io/tx/0x3fd67e3fc76afdd8674141f6d6472aedb32c1e32278555dbb5a2f69a82a94b43 (block 92371327; `claimable` → 0) |
| Audit (current pair, commit a5c1af9, 2 medium / 5 low / 2 info — released, see honest status) | — | https://github.com/Identity-md/research/blob/main/jobs/44df6543-f9d6-4f44-9d69-40e0f7223b0c/files/AUDIT.md |
| Superseded production pair (old wall+relay, shared address; relay lacked ERC-165, can never settle) | both chains | https://robin.etherscan.io/address/0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110 |
| NOTES token | Robinhood 4663 | https://robin.etherscan.io/token/0x03b76ccf7cfeec5198c81c5844b88a78e68a6173 |
| Launch tx (V4 Initialize + pool seeding, block 89,350,492) | Robinhood 4663 | https://robin.etherscan.io/tx/0x874397f3de80109a73ca8bae153efb7a9005cb73f8c271055f679b455fdc55f2 |
| IMD launch record | — | https://github.com/identity-md-launches/launch-1866-notes |
| Live CCIP settlement request (rehearsal on a 10-minute test wall, real mainnet, not the production wall) | Robinhood 4663 | https://robin.etherscan.io/tx/0x1752fa15d11007ad4bcf536ad19d1734783101454990566ff8edded56aaba163 |
| Live wiring via setRelay (rehearsal on a 10-minute test wall, real mainnet, not the production wall) | Robinhood 4663 | https://robin.etherscan.io/tx/0x55e4072f3d179afcd26165cad4508d02ab77944dd29be089238fb6548973fdd4 |
| Repo | — | https://github.com/gimogo/NTTW |
| Audit (earlier design, commit d063100 — kept as history; see the current-pair audit above) | — | https://github.com/Identity-md/research/blob/main/jobs/16c65a39-24f4-47d6-a9f5-2140c70791c6/files/AUDIT.md |
| IMD Radar submission | — | Submitted on IMD Radar 2026-10-20 (About text: `ENTRY_RADAR.txt`); add link after approval |

Honest status and known limits: the first production pair (deployed 2026-10-15) could never
settle — its relay bytecode predates the ERC-165 fix, so the CCIP off-ramp silently converted
data messages into token-only no-ops (observed live on-chain). It was replaced on 2026-10-16
with a fresh pair from the current source; on the new pair, ERC-165 is claimed
(`0x85572ffb` = true, `0xffffffff` = false without reverting), the runtime bytecode equals the
compiled artifact, and the wiring reads back both ways. The VRF fulfillment stall observed on
the test pairs (r2/r4) is Chainlink's off-chain fulfiller selection, not our plumbing — kept
here as history. On 2026-10-19 the production epoch 1 was settled end-to-end on the live pair:
requestSettlement → CCIP → immutable-relay VRF v2.5 fulfillment → `deliver(1)` → CCIP reply →
WinnerDrawn, with the full tx chain in the table above, the 500-NOTES pool credited and
`claimReward()` paid (settlementStatus(1) = Settled). Honest scope: epoch 1 had exactly one
ticket, from the deployer wallet, so the winner was predetermined — what is proven is the
end-to-end VRF→CCIP→wall path on production, not lottery fairness. Epoch 2 is live now and
ends 2026-10-22 04:28:50 UTC. Sybil resistance is cost-linear (1000 NOTES per ticket). Direct token
transfers to the wall are untracked and unrecoverable. The old wall's 500-NOTES epoch-1 pool
is permanently stranded (no sweep). The earlier audit (d063100) covered the superseded
top-10-leaderboard design; the current production pair at commit a5c1af9 was audited on
2026-10-16 (2 medium / 5 low / 2 info): all 9 findings are **acknowledged, not fixed in the
deployed contracts** (fixing would require a redeploy; contracts are frozen for this
submission) with operational mitigations in README §10 and the settlement runbook — the
highest-impact ones being: a stuck reply leg is finished with CCIP Explorer manual execution,
never a paid re-request; and the VRF subscription (owned by the deployer wallet) must never
be cancelled or lose the relay as consumer, or every prize pool strands — settlement liveness
depends on Chainlink fulfillment. Source-of-truth for epoch length is the on-chain constant
(EPOCH_DURATION = 259200 s = 3 days); the verified contract source NatSpec still says 7 days.
Explorer source verification of the new pair is still pending upload (Basescan showed the
relay Unverified as of 2026-10-16 07:13 UTC; Standard-JSON inputs are committed under
verification/). Epoch 1 is settled (2026-10-19): the single-ticket pool of 500 NOTES was drawn to its
holder and paid out via `claimReward()` — every step has a tx hash in the table above; the
run proves the cross-chain machinery end-to-end, while the winner identity was predetermined
by the 1-ticket epoch. Epoch 2 is live and ends 2026-10-22 04:28:50 UTC.

How NTTW uses IMD (verifiable facts; full sources and links in README §11):

- NOTES was launched through the IMD Protocol (launch tx 0x874397f3…dc55f2, Robinhood block
  89,350,492; launch repo github.com/identity-md-launches/launch-1866-notes): 1,000,000,000 NOTES
  split per the launch page as 88% pool liquidity / 10% to 409 contributing agents (Merkle
  distributor 0xd89c2f77…9f3) / 2% to the requester — corroborated by on-chain balanceOf readbacks
  (880M NOTES in the PoolManager, ≈99.8M in the distributor).
- The pool hook PoolInitializationGuard 0x19Bec7C2E1b2aadAf67b259744751a9960d66000 is IMD's
  launch hook, not our code (verified exact match on RobinScan; only beforeInitialize,
  factory-gated, no fee or swap/liquidity hooks).
- Both audits were run by the IMD swarm: job 16c65a39 on commit d063100 (the earlier
  top-10-leaderboard design, kept as history) and job 44df6543 on commit a5c1af9 (the current
  production pair: 2 medium / 5 low / 2 info, all findings acknowledged).
- Every stamp is paid in NOTES, an IMD-launched token: 500 burned to the dead address and 500
  pooled per stamp (IMDRetroWall.sol:118,121,124,355-356) — the fee sink and the prize pool both
  come from IMD-launched supply.
- Our custom contracts call no IMD oracle or job: the contract sources contain zero references to
  the IMD token, the launch factory, the PoolManager, the hook, or the distributor — they touch
  only NOTES as a plain ERC-20, Chainlink CCIP, and Chainlink VRF v2.5, all pinned immutably at
  deploy. The novelty is the Chainlink VRF + CCIP cross-chain winner settlement.

Links: repo https://github.com/gimogo/NTTW — X https://x.com/NotestotheW
(@NotestotheW) — Submitted on IMD Radar 2026-10-20.
