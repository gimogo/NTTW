# REDEPLOY PLAN — production wall + relay pair (prepared 2026-10-16, NOT executed)

> ✅ **EXECUTED 2026-10-16.** New production pair live and verified:
> wall `0x9550E4F888d1C084CB1C8E74677Da54109723EE3` (tx `0x96a95bb3…87dc7a`, block 89.795.280),
> relay `0x887bbed753938087Ce61Ca768a358848177E6eaA` (create tx `0x20c3ac0a…a84a37a2`,
> Base block 52.668.264), sub `5144183622…47214776` funded 0.0008 native, addConsumer
> `0x064d4d04…b6dec2`, relay 0.0005 ETH (`0x15c0c2f7…27833`), `setRelay`
> `0x3b7bb3b4…2828b928` (status 1). ERC-165 0x85572ffb=true / 0xffffffff=false;
> bytecode equality wall 19,431 B (16 immutable windows) & relay 4,073 B (18 zero-windows
> == 6 immutables), patched==live. Genesis 1792124930 → epoch 1 ends 2026-10-19 04:28:50 UTC.
> Funding adjustment disclosed before firing: VRF sub 0.0008 ETH (plan said 0.001).
> VRF sub funding billing native; every §0 decision point resolved: 3-day epoch, ~0.001–0.0015 top-ups.

Goal: replace the stale production pair (`0xbD4808f0…2110` on both chains) with a fresh pair
built from the **current fixed source** (the 4073-byte relay bytecode family — r2/r3/r4 today),
then re-wire and settle epochs on the new pair. Motivation evidence (all on-chain):
old relay bytecode 3939 bytes without the ERC-165 selector `01ffc9a7`; off-ramp
`0x16E577f1724AE2598F9b43a52C19E6f67eE13808` (OffRamp 2.0.0) silently converts data messages to
token-only no-ops when the receiver probe reverts (observed live: w1 message
`0x19cc5158…` SUCCESS at block 52650821 with zero receiver activity; w3 message FAILURE with
`UnexpectedSender(0x118a539c…1C2)` selector `0xf1ae97de`, block 52653889
(tx `0x2eb31a9d557600b4c1fba05806b4c54653267eda41b107f0f655096ede14b4c3`).

⚠️ Nothing in this document has been sent to any chain. Deployment waits for your explicit go.

## 0 · Sequencing (GAS FIRST — chain gas and CCIP/CHAINLINK immutables)

1. Compile (already verified twice) and — **decision needed** — set `EPOCH_DURATION` to `3 days` (§2).
2. (Robinhood) deploy the new wall: existing script does everything needed.
3. (Base) create a fresh native-ETH VRF subscription, deploy the new relay, `addConsumer(runner)`,
   fund both; env controlled.
4. (Robinhood) `setRelay(newRelay)` — exactly once; **do not** touch the old pair (no top-ups there).
5. Post-deploy (Base): verify ERC-165 on the relay + bytecode equality + wiring — §4. No stamps
   needed to enable the wall; the first stamped note starts epoch 1 tickets.

## 1 · Gas/cost estimate (read-only, `eth_estimateGas` + live `eth_gasPrice`)

gasPrice today: Robinhood **0.0202 gwei**, Base **0.006 gwei**.

| Step (chain) | Gas (estimate / historical) | Cost |
| --- | --- | --- |
| Wall deploy (Robinhood) | 4,346,040 | 0.000088 ETH |
| `setRelay` wiring (Robinhood) | ~25,000 (historical actuals 0.00000095–0.00000099 ETH) | 0.000001 ETH |
| Relay deploy (Base) | 945,148 | 0.0000057 ETH |
| `createSubscription` (Base) | estimation reverts on public RPCs (quirk) — historical bound | ≤ 0.000002 ETH |
| `fundSubscriptionWithNative` (Base) | transfer-class | ≤ 0.000002 ETH + 0.001 ETH of **actual value** |
| `addConsumer` (Base) | transfer-class | ≤ 0.000002 ETH |
| Relay ETH funding transfer (Base) | 21,000 – actual measured 0.00000012 ETH | 0.00000012 + 0.0005 ETH of **actual value** |

**Suggested wallet top-ups (NOT sent):**

| Chain | Purpose | Top-up |
| --- | --- | --- |
| Robinhood | already planned ~0.0002 for the w4/r4 retry — but redeploy needs 0.000088–0.0001 | add **+0.0002 at redeploy moment** (total across both uses ≈ 0.0004) |
| Base | 0.001 ETH VRF sub funding (comfortable for ≥ 6 epoch-words at typical native cost) + 0.0005 relay ETH (≈ 7 CCIP reply legs at the quoted 0.0000658) + gas headroom | **0.002 ETH** (comfortable 0.003) |

Old pair notes for the record: the stale production relay/sub are left **funded 0.0002/0.0002**
untouched (per your instruction); the old wall's epoch-1 pool (500 NOTES from the single stamp)
is **permanently stranded** inside the superseded wall — the wall has no sweep function. This is
disclosed in the README/entry updates below.

## 2 · EPOCH_DURATION: minimal change + test status

```
--- a/contracts/IMDRetroWall.sol
+++ b/contracts/IMDRetroWall.sol
@@ -134,1 +134,1 @@
-    uint256 public constant EPOCH_DURATION = 7 days;
+    uint256 public constant EPOCH_DURATION = 3 days;

--- a/test/IMDRetroWall.ts          (test-only; the suite advances time by EPOCH)
@@ -93,1 +93,1 @@
-const EPOCH = 7 * 24 * 60 * 60;
+const EPOCH = 3 * 24 * 60 * 60;
```

Verified live on the working tree with the 3-day variant applied: `hardhat compile` exit 0;
`npx hardhat test` **exit 0, 22 passing (16 s)**; `tsc -p tsconfig.hardhat.json --noEmit` exit 0;
`npm run typecheck` (frontend) exit 0. Note: the **test constant must always move with the
contract constant** (otherwise 3 time-based tests fail because the suite advances time by the
wallet of `EPOCH` alone). After measuring, the working tree was **reverted to 7 days**; the
choice is fully yours and is a 2-line re-apply.

Decision-relevant timing facts:

| Variant | Fresh epoch 1 (from deploy) ends | First possible production settlement | Hackathon deadline (~2026-10-23) |
| --- | --- | --- | --- |
| keep 7 days | ~7 days after deploy → ~2026-10-23 | **lands on the deadline** — near-zero settlement margin | ⏱ high risk of missing it entirely |
| 3 days | ~3 days after deploy → ~2026-10-20 | ~3 days of settlement margin | ✅ fits |

(All rehearsal evidence so far: the 10-minute test walls; no production epoch has settled yet.)

## 3 · Post-deploy verification checklist (all read-only)

1. **Source verification** on both explorers: verify the new wall on RobinScan, the new relay on
   Basescan (Standard JSON input, solc 0.8.20/optimizer as compiled) — the page must show
   "Source Code Verified" / "Exact Match" exactly as the old wall/NOTES pages do.
2. **ERC-165 check on the relay (cheap, decisive)** — the check that the OLD pair fails:
   `eth_call relay supportsInterface(0x1c7a1785…)` must return `true`, `supportsInterface(0xffffffff)`
   must return `false` (not revert!), and bytecode must contain `01ffc9a7`.
   (interface id from the *deployed* interface set, per `contracts/interfaces/ChainlinkCCIP.sol`.)
3. **Wiring read both ways**: `wall.relay() == relay.WALL() == <new pair>`; additionally
   `relay.VRF_COORDINATOR()/KEY_HASH()/SUBSCRIPTION_ID()/CCIP_ROUTER()` and
   `wall.CCIP_ROUTER()/RELAY_CHAIN_SELECTOR()` all match expectations.
4. **Bytecode equality vs compiled source**: `keccak256(relay.code)` must equal
   `keccak256(VrfCcipRelay.runtimeBytecode)` from build artifacts (runtime code is immutable-arg
   free — creation code carries them); same for the wall against `IMDRetroWall.runtimeBytecode`.
   Node helper command is in §6.
5. **Funding sanity**: relay ETH ≥ 0.0005, sub native ≥ 0.001, consumer = relay listed on the sub.

## 4 · Files to update once the new addresses exist (no edits made yet)

| File | Change |
| --- | --- |
| `README.md` §3 deployments table | add **new production wall + relay** rows, mark old pair `0xbD4808f0…2110` (both chains) `superseded`, add one sentence: *the superseded production relay lacks ERC-165, so the CCIP off-ramp silently converted its messages to token-only no-ops — the old production path could never request VRF.* |
| `README.md` §6 verification status | split the failure story into the two distinct causes (§5 below). |
| `README.md` §7 frontend env sample | replace `NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS` value with the new wall. |
| `.env.local` (frontend, local only) | same key, new wall address. |
| `FACTS.md` §1/§1a | add new wall/relay addresses + creation txs + bytecode-hash evidence; mark old pair superseded; keep old addresses for audit trail. |
| `ENTRY.md` | verify-it-yourself table: new wall + relay rows (old pair optional as "superseded"); "honest status" line notes the redeploy reason. |
| `ENTRY_RADAR.txt` | no address rows exist inside it today — only the phrase "(ERC-721, Robinhood 4663)". No change needed unless you want the redeploy mentioned; ~30-character headroom exists (932/950). |
| `scripts/settle-prod.ts` default addresses | point at the new pair. |
| `scripts/status.ts` | hardcoded W/RELAY consts → new pair. |

## 5 · README wording: the two distinct failure causes

Two lines proposed for §6 (replace the current single row "VRF pending on Chainlink"):

- **Superseded production pair — relay bytecode stale (fixed by redeploy).** The deployed relay of
  the old production pair predates the ERC-165 fix: it cannot answer the off-ramp's
  `supportsInterface` probe, so every wall→relay data message is executed as a token-only no-op
  (CCIP still reports SUCCESS). No VRF request ever reached the coordinator from the old relay —
  witnessed on-chain by w1's message SUCCESS with zero receiver activity, and by w3's
  `UnexpectedSender` FAILURE (relay bound to a different wall). Resolution: fresh pair redeploy.
- **Test pairs (r2/r4) — VRF fulfiller stall (open).** These relays are correct (ERC-165 claimed,
  `ccipReceive` verified by on-chain trace, two VRF requests committed on-chain), but the
  requests are pending for many hours — an off-chain Chainlink fulfiller-selection issue, not our
  plumbing. Evidence: sub `554014898…679128` `pendingRequestExists = true`, `reqCount = 0`, plus
  three probe requests on sub `693592238…789700`; support ticket text prepared 2026-10-16.

## 6 · Dry-run for the first `requestSettlement` (no transaction)

After the new pair is wired and funded (all read-only commands):

```bash
# (a) epoch state + fee quote via the InsufficientFee revert (works only when epoch1 has ended)
cast call --rpc-url https://rpc.mainnet.chain.robinhood.com <new-wall> \
  "requestSettlement(uint256)" 1 --value 0 || true   # must revert InsufficientFee(quotedFee)
# (b) full gas estimate for the real send (no state change)
cast estimate --rpc-url https://rpc.mainnet.chain.robinhood.com <new-wall> \
  "requestSettlement(uint256)" 1 --value <quotedFee>
# (c) monitor-ability dry-run: confirm the exact events subscribe cleanly
cast logs --rpc-url https://mainnet.base.org --address <new-relay> \
  --topic0 0x$(cast sig-event "RandomnessRequested(uint256,uint256)") --from-block latest
# (d) bytecode-hash equality check (dead giveaway if anyone swapped the binary)
node -e 'const e=require("ethers"),a=require("fs");(async()=>{const p=new e.JsonRpcProvider("https://mainnet.base.org");const art=require("./artifacts/contracts/VrfCcipRelay.sol/VrfCcipRelay.json");const runtime=art.deployedBytecode;const live=await p.getCode(<new-relay>) ;console.log("runtime equal:", live.toLowerCase()===runtime.toLowerCase())})()'
```

Important dry-run caveat: a fresh wall starts epoch 1 at deploy time, so `requestSettlement(1)`
can only be dry-run-checked **after the fresh epoch 1 ends** (3 or 7 days later — the deadline
table in §2). You can still dry-run every other leg (relay ERC-165 probe, wiring, funding, event
subscribe) the moment the pair is live.

Fallback decision points (recorded for the go-ahead message):

- [ ] approve redeploy ✅/❌
- [ ] EPOCH_DURATION: 3 days or keep 7 days
- [ ] voucher amounts: Robinhood +0.0002 at redeploy; Base 0.002 (accept or adjust)
- [ ]redeploy implies the old wall's 500-NOTES epoch-1 pool is abandoned (unrecoverable) — accept
