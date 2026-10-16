import { ethers, network } from "hardhat";

/**
 * PRODUCTION plan — settle epoch 1 of the production wall.
 *
 *   npx hardhat run scripts/settle-prod.ts --network robinhood
 *
 * Runbook: RUNBOOK_PROD_SETTLEMENT.md. This script is prepared but intentionally
 * NOT executed; fire it after epoch 1 ends (2026-10-19 04:28:50 UTC).
 *
 * Preflight (read-only):
 *   0. Verifies wall/relay wiring both directions and that the relay bytecode
 *      actually implements ERC-165 (`supportsInterface`). The off-ramp silently
 *      converts a data message into a no-op if the receiver cannot prove the
 *      IAny2EVMMessageReceiver interface — the superseded production relay did not
 *      (see RUNBOOK_PROD_SETTLEMENT.md); the redeployed pair claims it (verified).
 *      Keep the check active on every settle run.
 *   1. Waits until currentEpoch() == 2 (epoch 1 ended).
 *   2. Reads the exact CCIP fee from the InsufficientFee revert.
 * Execution (needs signer):
 *   3. Sends requestSettlement(1) with that fee.
 * Monitoring (read-only, up to 24 h):
 *   4. Polls the relay (epoch readiness), the coordinator request/fulfil events
 *      (via the relay's RandomnessRequested tx), and the wall WinnerDrawn topic.
 */

const BASE_RPC = "https://mainnet.base.org";
const RH_RPC = "https://rpc.mainnet.chain.robinhood.com";
const VRFC_BASE = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";
// Production pair redeployed 2026-10-16 (old relay 0xbD4808f0…2110 lacked ERC-165 and is superseded).
const DEFAULT_WALL = "0x9550E4F888d1C084CB1C8E74677Da54109723EE3";
const DEFAULT_RELAY = "0x887bbed753938087Ce61Ca768a358848177E6eaA";
// Actual signature (contracts/IMDRetroWall.sol:232):
// event WinnerDrawn(uint256 indexed epoch, address indexed winner, uint256 prize, uint256 randomWord)
const WINNER_DRAWN_TOPIC0 = ethers.id(
  "WinnerDrawn(uint256,address,uint256,uint256)"
);
const POLL_MS = 30_000;
const MONITOR_MS = 24 * 60 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wallAddr = process.env.PROD_WALL_ADDRESS || DEFAULT_WALL;
  const relayAddr = process.env.PROD_RELAY_ADDRESS || DEFAULT_RELAY;
  await ethers.provider.call; // touch to ensure RPC alive
  const rh = new ethers.JsonRpcProvider(RH_RPC);
  const base = new ethers.JsonRpcProvider(BASE_RPC);

  console.log(`[preflight] wall ${wallAddr} | relay ${relayAddr}`);

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
  ], rh);
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
      "request will ever reach the coordinator — this is exactly what happened to test-wall pair " +
      "w1/r1. Redeploy a fresh wall+relay pair from the current source BEFORE settling. Aborting."
    );
    process.exit(2);
  }

  // 1. Wait for epoch 1 to end.
  let cur: bigint = await wall.currentEpoch();
  while (cur < 2n) {
    const left = await wall.timeUntilEpochEnd();
    console.log(`[wait] currentEpoch=${cur}, ${left}s left; retrying in ${Math.min(60, Math.max(5, Number(left) / 10))}s`);
    await sleep(Math.min(60_000, Math.max(5_000, Number(left) * 100)));
    cur = await wall.currentEpoch();
  }
  const tickets = await wall.ticketCount(1);
  const prize = await wall.epochPrize(1);
  const status = await wall.settlementStatus(1);
  console.log(`[epoch1] tickets=${tickets} prize=${ethers.formatEther(prize)} NOTES status=${status} (0=None,1=Requested,2=Settled)`);
  if (tickets === 0n) {
    console.log("[epoch1] no tickets — epoch settles as WinnerDrawn(1,0,0,0); requestSettlement still required.");
  } else if (status === 2n) {
    console.log("[epoch1] already settled.");
    return;
  }

  // 2. Fee discovery (exact, via the InsufficientFee revert).
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
  console.log(`[fee] CCIP fee quoted: ${ethers.formatEther(fee)} ETH`);
  const wallet = (await ethers.getSigners())[0];
  const bal = await ethers.provider.getBalance(wallet.address);
  if (bal < fee + ethers.parseEther("0.00002")) {
    throw new Error(`Wallet gas+fee budget insufficient: has ${ethers.formatEther(bal)}, needs fee ${ethers.formatEther(fee)} + ~2e-5 gas.`);
  }

  // 3. Execute.
  const tx = await wall.requestSettlement(1n, { value: fee });
  const rc = await tx.wait();
  console.log(`[tx] requestSettlement(1) ${tx.hash} status ${rc?.status} block ${rc?.blockNumber}`);
  if (rc?.status !== 1) throw new Error("requestSettlement reverted");

  // 4. Live monitor both chains.
  const relay = new ethers.Contract(relayAddr, [
    "event RandomnessRequested(uint256 indexed epoch, uint256 indexed requestId)",
    "event RandomnessReceived(uint256 indexed epoch, uint256 randomWord)",
    "event RandomnessDelivered(uint256 indexed epoch, bytes32 indexed messageId)",
    "function randomnessReady(uint256) view returns (bool)",
    "function delivered(uint256) view returns (bool)",
  ], base);
  const subId: bigint = await rel.SUBSCRIPTION_ID();
  const keyHash = await rel.KEY_HASH();
  console.log(`[monitor] sub ${subId} keyHash ${keyHash}; polling every ${POLL_MS / 1000}s until WinnerDrawn or ${MONITOR_MS / 60_000} min`);

  let requestId: bigint | undefined;
  const t0 = Date.now();
  while (Date.now() - t0 < MONITOR_MS) {
    const [ready, delivered] = [await relay.randomnessReady(1n), await relay.delivered(1n)];
    // Fetch (only once) the RandomnessRequested event from the relay side
    if (requestId === undefined) {
      try {
        const head = await base.getBlockNumber();
        const logs = await base.getLogs({ address: relayAddr, fromBlock: Math.max(0, head - 3000), toBlock: head });
        for (const l of logs) {
          try {
            const ev = relay.interface.parseLog({ topics: l.topics as string[], data: l.data });
            if (ev && ev.name === "RandomnessRequested") { requestId = ev.args.requestId; console.log(`[monitor] VRF requestId ${requestId?.toString()}`); break; }
          } catch { /* ignore unknown topics */ }
        }
      } catch { /* rpc hiccup tolerated */ }
    }
    const wallLogs = await rh.getLogs({ address: wallAddr, topics: [[WINNER_DRAWN_TOPIC0]], fromBlock: rc!.blockNumber, toBlock: "latest" });
    if (wallLogs.length > 0) {
      console.log(`[monitor] WinnerDrawn detected — tx ${wallLogs[0].transactionHash}; settlement COMPLETE.`);
      return;
    }
    console.log(`[monitor ${new Date().toISOString()}] ready=${ready} delivered=${delivered} requestId=${requestId?.toString() ?? "pending"}`);
    await sleep(POLL_MS);
  }
  console.error("[monitor] timeout without WinnerDrawn — the VRF word never arrived within 24 h; see runbook fallbacks.");
  process.exitCode = 3;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
