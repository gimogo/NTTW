import { ethers, network } from "hardhat";

/**
 * PRODUCTION plan — settle epoch 1 of the production wall (full 4-step sequence).
 *
 *   npx hardhat run scripts/settle-prod.ts --network robinhood          # execute (after epoch 1 ends)
 *   SETTLE_DRY_RUN=1 npx hardhat run scripts/settle-prod.ts --network robinhood   # read-only preflight
 *
 * Runbook: RUNBOOK_PROD_SETTLEMENT.md. Prepared but NOT executed; fire it after
 * epoch 1 ends (2026-10-19 04:28:50 UTC). No contract or test file was changed for
 * this flow (audit finding #6 fix lives HERE, in operational tooling).
 *
 * The exact sequence (matches RUNBOOK_PROD_SETTLEMENT.md):
 *   1. requestSettlement(1) on the wall, paying the quoted CCIP fee — at most ONCE.
 *      NEVER re-request while pending: a second request inside SETTLEMENT_RETRY_DELAY
 *      (1 day) reverts on the wall (SettlementPending), and after it a retry spawns an
 *      extra paid VRF request for the same epoch (audit finding #4), draining the
 *      subscription. This script therefore sends requestSettlement AT MOST once per
 *      run and never within the retry window.
 *   2. Poll randomnessReady(1) on the relay (Base) — the rawFulfillRandomWords event
 *      only records the word; nothing is sent automatically (audit finding #6).
 *   3. Once ready, call relay.deliver(1) on Base — permissionless; gas from the
 *      deployer wallet, CCIP reply fee from the relay's ETH balance. If
 *      delivered(1) is ALREADY true while the wall is still Requested, the reply
 *      message was handed to the router but never executed on the wall — do NOT
 *      deliver or re-request; the epoch can still be completed via the CCIP
 *      Explorer manual-execution fallback (see runbook).
 *   4. Monitor WinnerDrawn on the wall; the winner then calls claimReward() on their
 *      own wallet.
 *
 * Preflight (read-only):
 *   0. Verifies wall/relay wiring both directions and that the relay bytecode
 *      actually implements ERC-165 (supportsInterface). The off-ramp silently
 *      converts a data message into a no-op if the receiver cannot prove the
 *      IAny2EVMMessageReceiver interface — the superseded production relay did not;
 *      the redeployed pair claims it (verified). Keep the check active on every run.
 */

const BASE_RPC = "https://mainnet.base.org";
const RH_RPC = "https://rpc.mainnet.chain.robinhood.com";
const VRFC_BASE = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";
// CCIP Explorer: paste a messageId there to inspect / manually execute a stuck reply leg.
const CCIP_EXPLORER = "https://ccip.chain.link";
// Production pair redeployed 2026-10-16 (old relay 0xbD4808f0…2110 lacked ERC-165 and is superseded).
const DEFAULT_WALL = "0x9550E4F888d1C084CB1C8E74677Da54109723EE3";
const DEFAULT_RELAY = "0x887bbed753938087Ce61Ca768a358848177E6eaA";
// Robinhood block of the current wall's creation (tx 0x96a95bb3…87dc7a, block 89,795,280).
const DEFAULT_WALL_CREATION_BLOCK = 89_795_280;
// Actual signature (contracts/IMDRetroWall.sol:232):
// event WinnerDrawn(uint256 indexed epoch, address indexed winner, uint256 prize, uint256 randomWord)
const WINNER_DRAWN_TOPIC0 = ethers.id("WinnerDrawn(uint256,address,uint256,uint256)");
const POLL_MS = 30_000;
const MONITOR_MS = 24 * 60 * 60_000;

const DRY_RUN = process.env.SETTLE_DRY_RUN === "1";

const statusName = (s: bigint) => ({ 0: "None", 1: "Requested", 2: "Settled" }[s.toString()] ?? String(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wallAddr = process.env.PROD_WALL_ADDRESS || DEFAULT_WALL;
  const relayAddr = process.env.PROD_RELAY_ADDRESS || DEFAULT_RELAY;
  await ethers.provider.call; // touch to ensure RPC alive
  const rh = new ethers.JsonRpcProvider(RH_RPC);
  const base = new ethers.JsonRpcProvider(BASE_RPC);

  console.log(`[preflight] wall ${wallAddr} | relay ${relayAddr}` + (DRY_RUN ? " (DRY RUN — read-only)" : ""));

  // 0. Wiring + ERC-165 capability of the DEPLOYED relay bytecode.
  const rel = new ethers.Contract(relayAddr, [
    "function WALL() view returns (address)",
    "function SUBSCRIPTION_ID() view returns (uint256)",
    "function KEY_HASH() view returns (bytes32)",
  ], base);
  const wall = new ethers.Contract(wallAddr, [
    "function relay() view returns (address)",
    "function currentEpoch() view returns (uint256)",
    "function GENESIS() view returns (uint256)",
    "function timeUntilEpochEnd() view returns (uint256)",
    "function ticketCount(uint256) view returns (uint256)",
    "function epochPrize(uint256) view returns (uint256)",
    "function settlementStatus(uint256) view returns (uint8)",
    "function requestSettlement(uint256) payable",
    // errors (contracts/IMDRetroWall.sol:254-265) — without them parseError
    // returns null on the fee-discovery revert and the run aborts.
    "error InsufficientFee(uint256 required, uint256 provided)",
  ], rh);
  const relay = new ethers.Contract(relayAddr, [
    "event RandomnessRequested(uint256 indexed epoch, uint256 indexed requestId)",
    "event RandomnessDelivered(uint256 indexed epoch, bytes32 indexed messageId)",
    "function randomnessReady(uint256) view returns (bool)",
    "function delivered(uint256) view returns (bool)",
  ], base);

  const wallRelay = await wall.relay();
  const relayWall = await rel.WALL();
  console.log(`[preflight] wall.relay()=${wallRelay} relay.WALL()=${relayWall}`);
  if (wallRelay.toLowerCase() !== relayAddr.toLowerCase() || relayWall.toLowerCase() !== wallAddr.toLowerCase())
    throw new Error("Preflight failed: wall/relay wiring mismatch — do NOT send.");

  const relayCode = await base.getCode(relayAddr);
  const hasErc165 = relayCode.includes("01ffc9a7");
  console.log(`[preflight] relay bytecode ${(relayCode.length - 2) / 2} bytes | implements supportsInterface: ${hasErc165}`);
  if (!hasErc165) {
    console.error(
      "[preflight] FATAL: relay bytecode does not implement ERC-165. The CCIP off-ramp will " +
      "treat the data message as token-only (status SUCCESS without calling ccipReceive) and no " +
      "request will ever reach the coordinator — this is exactly what happened to the superseded " +
      "pair. Redeploy a fresh wall+relay pair from the current source BEFORE settling. Aborting."
    );
    process.exit(2);
  }

  // Funding sanity (read-only): relay CCIP ETH + VRF subscription balance + consumer list.
  const subId: bigint = await rel.SUBSCRIPTION_ID();
  const keyHash = await rel.KEY_HASH();
  const vrf = new ethers.Contract(VRFC_BASE, [
    "function getSubscription(uint256) view returns (uint96,uint96,uint64,address,address[])",
  ], base);
  const sub = await vrf.getSubscription(subId);
  console.log(`[preflight] VRF sub ${subId} native=${ethers.formatEther(sub[1])} ETH reqCount=${sub[2].toString()} consumers=${sub[4].join(",")} | keyHash ${keyHash}`);
  console.log(`[preflight] relay ETH balance: ${ethers.formatEther(await base.getBalance(relayAddr))}`);
  if (sub[1] === 0n) {
    console.error("[preflight] FATAL: VRF subscription empty — top it up (permissionless) before settling. Aborting.");
    process.exit(2);
  }

  // 1. Epoch state. (In dry-run mode we do NOT wait.)
  let cur: bigint = await wall.currentEpoch();
  if (!DRY_RUN) {
    while (cur < 2n) {
      const left = await wall.timeUntilEpochEnd();
      console.log(`[wait] currentEpoch=${cur}, ${left}s left; next poll in ${Math.min(60_000, Math.max(5_000, Number(left) * 100))}ms`);
      await sleep(Math.min(60_000, Math.max(5_000, Number(left) * 100)));
      cur = await wall.currentEpoch();
    }
  }
  const tickets = await wall.ticketCount(1);
  const prize = await wall.epochPrize(1);
  let status: bigint = await wall.settlementStatus(1);
  console.log(`[epoch1] tickets=${tickets} prize=${ethers.formatEther(prize)} NOTES status=${statusName(status)}`);

  if (DRY_RUN) {
    // Fee quote works (via InsufficientFee revert) only after epoch 1 has ended.
    if (cur >= 2n && status === 0n) {
      try {
        await wall.requestSettlement.staticCall(1n, { value: 0n });
        console.error("[dry] zero-value requestSettlement unexpectedly succeeded — investigate.");
        process.exitCode = 2;
        return;
      } catch (err: any) {
        const data: string | undefined = err?.data ?? err?.info?.error?.data;
        if (!data) throw err;
        const parsed = wall.interface.parseError(data);
        if (parsed && parsed.name === "InsufficientFee") {
          console.log(`[dry] CCIP fee will be ${ethers.formatEther(parsed.args[0] as bigint)} ETH.`);
        } else {
          console.log(`[dry] revert: ${parsed ? parsed.name : "unknown"} (non-blocking for the dry run).`);
        }
      }
    }
    // What the executable run would do (no transaction):
    console.log(`[dry] would send requestSettlement(1) ONCE iff status None and epoch ended; then poll randomnessReady(1); ` +
      `once true send relay.deliver(1) on Base (only if not yet delivered); then watch WinnerDrawn. ` +
      `NEVER re-requests while pending.`);
    console.log(`[dry] DRY RUN OK — read-only preflight complete. No transaction was sent.`);
    return;
  }

  if (tickets === 0n) {
    console.log("[epoch1] no tickets — epoch settles as WinnerDrawn(1,0,0,0); requestSettlement still required.");
  }
  if (status === 2n) {
    console.log("[epoch1] already settled — nothing to do.");
    return;
  }

  // 2. requestSettlement(1) — AT MOST ONCE. If a request is already in flight
  //    (Requested), DO NOT re-send (retry-window rule, audit findings #1/#4/#6).
  let requestBlock: number;
  if (status === 1n) {
    console.log("[step1] epoch 1 is already Requested — an earlier requestSettlement is in flight; do NOT re-request while pending. Proceeding to the deliver step.");
    requestBlock = 0; // scan for WinnerDrawn from an early block below
  } else {
    // Fee discovery (exact, via the InsufficientFee revert).
    let fee: bigint;
    try {
      await wall.requestSettlement.staticCall(1n, { value: 0n });
      throw new Error("zero-value requestSettlement unexpectedly succeeded");
    } catch (err: any) {
      const data: string | undefined = err?.data ?? err?.info?.error?.data;
      if (!data) throw err;
      const parsed = wall.interface.parseError(data);
      if (!parsed || parsed.name !== "InsufficientFee") throw err;
      fee = parsed.args[0] as bigint;
    }
    console.log(`[step1] CCIP fee quoted: ${ethers.formatEther(fee)} ETH`);
    const wallet = (await ethers.getSigners())[0];
    const bal = await ethers.provider.getBalance(wallet.address);
    if (bal < fee + ethers.parseEther("0.00002")) {
      throw new Error(`Wallet gas+fee budget insufficient: has ${ethers.formatEther(bal)}, needs fee ${ethers.formatEther(fee)} + gas margin.`);
    }
    // connect() widens the ABI proxy typing; reinstate the wall's own signature.
    const tx = await (wall.connect(wallet) as typeof wall).requestSettlement(1n, { value: fee });
    const rc = await tx.wait();
    requestBlock = rc!.blockNumber;
    console.log(`[step1] requestSettlement(1) ${tx.hash} status ${rc!.status} block ${requestBlock}`);
    if (rc!.status !== 1) throw new Error("requestSettlement reverted");
    console.log("[step1] request sent once. It will NOT be sent again while pending");
    console.log("       (within SETTLEMENT_RETRY_DELAY=1day it reverts SettlementPending, and");
    console.log("       a later re-request would spawn an extra paid VRF request — audit #4).");
  }

  // 3. Poll randomnessReady(1); when the word is known, call relay.deliver(1) on Base.
  //    deliver() is permissionless; the deployer pays only Base gas — the CCIP reply
  //    fee comes from the relay's own ETH balance.
  const baseBn = await base.getBlockNumber();
  const FROM_BLOCK = requestBlock || Math.max(0, baseBn - 7200); // ~24h of Base blocks
  let deliverDone = false;
  const t0 = Date.now();
  while (Date.now() - t0 < MONITOR_MS) {
    const wallFromBlock = requestBlock || DEFAULT_WALL_CREATION_BLOCK;
    const wallLogs = await rh.getLogs({ address: wallAddr, topics: [[WINNER_DRAWN_TOPIC0]], fromBlock: wallFromBlock, toBlock: "latest" });
    if (wallLogs.length > 0) {
      console.log(`[done] WinnerDrawn detected — tx ${wallLogs[0].transactionHash}; settlement COMPLETE.`);
      console.log(`[done] winner then claims with claimReward() from their own wallet (pull-based).`);
      return;
    }

    const ready = await relay.randomnessReady(1n);
    const delivered = await relay.delivered(1n);

    if (ready && !delivered && !deliverDone) {
      // The word is known but has never been handed to the router — send it now.
      const [signer] = await ethers.getSigners();
      const baseProvider = new ethers.JsonRpcProvider(BASE_RPC);
      const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY || "", baseProvider);
      const walletAddress = wallet.address; // address is public; the KEY itself is never printed
      if (walletAddress.toLowerCase() !== signer.address.toLowerCase())
        throw new Error("DEPLOYER_PRIVATE_KEY does not match the hardhat signer — refusing to deliver from another wallet.");
      const gasBal = await baseProvider.getBalance(walletAddress);
      if (gasBal < ethers.parseEther("0.000001")) {
        console.error(`[step3] deployer Base balance too low for deliver() gas (${ethers.formatEther(gasBal)} ETH) — top up on Base; deliver(1) is permissionless once funded.`);
      } else {
        console.log(`[step3] randomnessReady(1)=true and delivered(1)=false — sending relay.deliver(1) from ${walletAddress} on Base…`);
        const wc = new ethers.Contract(relayAddr, ["function deliver(uint256) returns (bytes32)"], wallet.connect(baseProvider));
        const dtx = await wc.deliver(1n);
        const drc = await dtx.wait();
        console.log(`[step3] deliver(1) ${dtx.hash} status ${drc!.status} block ${drc!.blockNumber}`);
        if (drc!.status !== 1) throw new Error("deliver(1) reverted");
        deliverDone = true;
      }
    } else if (ready && delivered && !deliverDone) {
      // Word already handed to the router in some earlier run — find the messageId
      // for the CCIP Explorer manual-execution fallback; do NOT deliver again, do NOT re-request.
      deliverDone = true;
      try {
        const head = await base.getBlockNumber();
        const logs = await base.getLogs({
          address: relayAddr,
          fromBlock: FROM_BLOCK,
          toBlock: head,
        });
        for (const l of logs) {
          try {
            const ev = relay.interface.parseLog({ topics: l.topics as string[], data: l.data });
            if (ev && ev.name === "RandomnessDelivered" && ev.args.epoch === 1n) {
              console.log(`[step3] reply message ${ev.args.messageId} was already sent by an earlier deliver.`);
              console.log(`[step3] If the wall stays Requested, the reply leg is stuck: open ${CCIP_EXPLORER},`);
              console.log(`[step3] paste the messageId and use "Manually Execute" (it is still SUCCESS-safe to`);
              console.log(`[step3] re-execute: the wall rejects a duplicate with EpochAlreadySettled).`);
              console.log(`[step3] Do NOT requestSettlement again while pending (burns the fee — audit #1).`);
            }
          } catch { /* ignore unknown topics */ }
        }
      } catch { /* rpc hiccup tolerated */ }
      console.log(`[step3] word was already delivered earlier; now only waiting for WinnerDrawn.`);
    }

    let requestIdLog: string = "pending";
    try {
      const head = await base.getBlockNumber();
      const logs = await base.getLogs({ address: relayAddr, fromBlock: FROM_BLOCK, toBlock: head });
      for (const l of logs) {
        try {
          const ev = relay.interface.parseLog({ topics: l.topics as string[], data: l.data });
          if (ev && ev.name === "RandomnessRequested") { requestIdLog = ev.args.requestId.toString(); }
        } catch { /* ignore unknown topics */ }
      }
    } catch { /* rpc hiccup tolerated */ }
    console.log(`[monitor ${new Date().toISOString()}] ready=${ready} delivered=${delivered} requestId=${requestIdLog}`);
    await sleep(POLL_MS);
  }
  console.error("[monitor] timeout without WinnerDrawn — see RUNBOOK_PROD_SETTLEMENT.md fallbacks:");
  console.error("         (a) if randomnessReady(1)=true: relay.deliver(1) on Base (permissionless);");
  console.error("         (b) if the reply leg is stuck in CCIP: manually execute via CCIP Explorer;");
  console.error("         (c) only after the 1-day retry window AND a delivered-but-stuck reply: consider");
  console.error("             re-request — it spawns an extra VRF request for the same epoch (audit #4); the");
  console.error("             first word wins, the extra one is dropped. Never request twice inside the window.");
  process.exitCode = 3;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
