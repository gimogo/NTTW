# ENTRY.md — Notes To The World (NTTW)

Notes To The World is a permanent, fully on-chain corkboard where every sticky note is an
ERC-721 and each weekly prize pool paid from 1000-NOTES stamp fees is settled cross-chain
by Chainlink VRF v2.5 delivered over Chainlink CCIP.

How it works:

- Stamping a note (<= 280 bytes UTF-8, stored in the NFT itself, no IPFS) costs 1000 NOTES
  paid atomically by the wall: 500 burned to 0x...dEaD, 500 pooled, and the stamp is a
  ticket (IMDRetroWall.sol:355-356, :118).
- Epochs are genesis-based windows (3 days on the production wall redeployed 2026-10-16;
  IMDRetroWall.sol:134); max 5 tickets per address per epoch (MAX_STAMPS_PER_EPOCH, :137).
- At epoch end, anyone calls requestSettlement(epoch) and pays the exact CCIP fee; the wall
  forwards one integer (the epoch) to an ownerless VrfCcipRelay on Base, which requests one
  Chainlink VRF v2.5 word and forwards the first word back over CCIP.
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
| Live app | Robinhood 4663 | TODO — add the deployed frontend URL before submission |
| Superseded production pair (old wall+relay, shared address; relay lacked ERC-165, can never settle) | both chains | https://robin.etherscan.io/address/0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110 |
| NOTES token | Robinhood 4663 | https://robin.etherscan.io/token/0x03b76ccf7cfeec5198c81c5844b88a78e68a6173 |
| Launch tx (V4 Initialize + pool seeding, block 89,350,492) | Robinhood 4663 | https://robin.etherscan.io/tx/0x874397f3de80109a73ca8bae153efb7a9005cb73f8c271055f679b455fdc55f2 |
| IMD launch record | — | https://github.com/identity-md-launches/launch-1866-notes |
| Live CCIP settlement request (rehearsal on a 10-minute test wall, real mainnet, not the production wall) | Robinhood 4663 | https://robin.etherscan.io/tx/0x1752fa15d11007ad4bcf536ad19d1734783101454990566ff8edded56aaba163 |
| Live wiring via setRelay (rehearsal on a 10-minute test wall, real mainnet, not the production wall) | Robinhood 4663 | https://robin.etherscan.io/tx/0x55e4072f3d179afcd26165cad4508d02ab77944dd29be089238fb6548973fdd4 |
| Repo | — | https://github.com/gimogo/NTTW |
| Audit (earlier design, commit d063100) | — | https://github.com/Identity-md/research/blob/main/jobs/16c65a39-24f4-47d6-a9f5-2140c70791c6/files/AUDIT.md |
| IMD Radar submission | — | add link after submission |

Honest status and known limits: the first production pair (deployed 2026-10-15) could never
settle — its relay bytecode predates the ERC-165 fix, so the CCIP off-ramp silently converted
data messages into token-only no-ops (observed live on-chain). It was replaced on 2026-10-16
with a fresh pair from the current source; on the new pair, ERC-165 is claimed
(`0x85572ffb` = true, `0xffffffff` = false without reverting), the runtime bytecode equals the
compiled artifact, and the wiring reads back both ways. Epoch 1 ends 2026-10-19 04:28:50 UTC;
the VRF fulfillment stall observed on the test pairs (r2/r4) is Chainlink's off-chain
fulfiller selection, not our plumbing — no WinnerDrawn has happened on mainnet yet and no
prize has been paid. Sybil resistance is cost-linear (1000 NOTES per ticket). Direct token
transfers to the wall are untracked and unrecoverable. The old wall's 500-NOTES epoch-1 pool
is permanently stranded (no sweep). The audit covered the superseded top-10-leaderboard
design at commit d063100; v3 itself has not been re-audited.

Links: repo https://github.com/gimogo/NTTW — X https://x.com/NotestotheW
(@NotestotheW) — IMD Radar: add link after submission.
