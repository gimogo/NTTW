import { ethers, network } from "hardhat";
import type { EventLog } from "ethers";

/**
 * TEST ONLY — end-to-end settlement check for the 10-minute test wall.
 *
 *   WALL_ADDRESS=0x... RELAY_ADDRESS=0x... npx hardhat run scripts/settle-test.ts --network robinhood
 *
 * 1. Waits until the wall's current epoch is greater than 1.
 * 2. Reads the CCIP fee from the InsufficientFee revert of a zero-value call.
 * 3. Calls requestSettlement(1) with that fee.
 * 4. Polls Base for RandomnessRequested / RandomnessDelivered on the relay,
 *    and Robinhood for WinnerDrawn on the wall.
 */

const BASE_RPC = "https://mainnet.base.org";
const RELAY_ABI = [
  "event RandomnessRequested(uint256 indexed epoch, uint256 indexed requestId)",
  "event RandomnessReceived(uint256 indexed epoch, uint256 randomWord)",
  "event RandomnessDelivered(uint256 indexed epoch, bytes32 indexed messageId)",
];
const POLL_MS = 15_000;
const MONITOR_TIMEOUT_MS = 90 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (network.name !== "robinhood") throw new Error(`Run on robinhood, got ${network.name}.`);
  const wallAddr = process.env.WALL_ADDRESS;
  const relayAddr = process.env.RELAY_ADDRESS;
  if (!wallAddr || !/^0x[0-9a-fA-F]{40}$/.test(wallAddr)) throw new Error("WALL_ADDRESS missing or invalid.");
  if (!relayAddr || !/^0x[0-9a-fA-F]{40}$/.test(relayAddr)) throw new Error("RELAY_ADDRESS missing or invalid.");

  const [signer] = await ethers.getSigners();
  const wall = await ethers.getContractAt("IMDRetroWallShortEpoch", wallAddr, signer);
  const EPOCH = 1n;

  let rc: { blockNumber: number; status: number | null } | null;
  const existingTx = process.env.SETTLE_TX;
  if (existingTx) {
    // Resume monitoring a settlement request that was already sent.
    rc = await ethers.provider.getTransactionReceipt(existingTx);
    if (!rc || rc.status !== 1) throw new Error(`SETTLE_TX ${existingTx} is not a successful receipt.`);
    console.log(`Resuming monitor for requestSettlement tx ${existingTx} (block ${rc.blockNumber})`);
  } else {
    // 1. Wait for epoch 1 to end.
    for (;;) {
      const cur: bigint = await wall.currentEpoch();
      if (cur > EPOCH) break;
      const left = await wall.timeUntilEpochEnd();
      console.log(`[${new Date().toISOString()}] current epoch ${cur}, ${left}s left in epoch`);
      await sleep(Math.min(POLL_MS, Math.max(5_000, Number(left) * 1000)));
    }
    console.log(`Epoch ${EPOCH} ended. Tickets: ${await wall.ticketCount(EPOCH)}, prize: ${ethers.formatEther(await wall.epochPrize(EPOCH))} NOTES`);

    // 2. Read the required fee from the InsufficientFee revert.
    let fee: bigint;
    try {
      await wall.requestSettlement.staticCall(EPOCH, { value: 0n });
      throw new Error("Zero-value requestSettlement unexpectedly succeeded.");
    } catch (err: any) {
      const data = err?.data ?? err?.info?.error?.data;
      if (!data) throw err;
      const parsed = wall.interface.parseError(data);
      if (!parsed || parsed.name !== "InsufficientFee") throw err;
      fee = parsed.args[0] as bigint;
    }
    console.log(`Required CCIP fee: ${ethers.formatEther(fee)} ETH`);

    // 3. Send the settlement request.
    const tx = await wall.requestSettlement(EPOCH, { value: fee });
    const r = await tx.wait();
    console.log(`requestSettlement tx ${tx.hash} status ${r!.status} block ${r!.blockNumber}`);
    if (r!.status !== 1) throw new Error("requestSettlement reverted.");
    rc = r;
  }

  // 4. Monitor Base (relay) and Robinhood (wall).
  const base = new ethers.JsonRpcProvider(BASE_RPC);
  const relay = new ethers.Contract(relayAddr, RELAY_ABI, base);
  const deadline = Date.now() + MONITOR_TIMEOUT_MS;
  let requested = false;
  let delivered = false;
  // Base public RPC rate-limits eth_getLogs, so each query is retried and a
  // failed query never aborts the monitor. Scan from the request block onward.
  const baseHeadAtStart = await base.getBlockNumber();
  const BASE_SCAN_FROM = baseHeadAtStart - 300; // ~10 min of Base blocks
  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (err: any) {
      console.log(`[${new Date().toISOString()}] ${label} query failed, will retry: ${err?.shortMessage ?? err?.message}`);
      return undefined;
    }
  };
  while (Date.now() < deadline) {
    const head = await safe("Base head", () => base.getBlockNumber());
    if (head !== undefined) {
      if (!requested) {
        const logs = await safe("RandomnessRequested", () =>
          relay.queryFilter(relay.filters.RandomnessRequested(EPOCH), BASE_SCAN_FROM, head));
        if (logs && logs.length) {
          requested = true;
          const ev = logs[0] as EventLog;
          console.log(`Base RandomnessRequested epoch ${EPOCH} requestId ${ev.args.requestId} tx ${ev.transactionHash}`);
        }
      }
      if (requested && !delivered) {
        const logs = await safe("RandomnessDelivered", () =>
          relay.queryFilter(relay.filters.RandomnessDelivered(EPOCH), BASE_SCAN_FROM, head));
        if (logs && logs.length) {
          delivered = true;
          const ev = logs[0] as EventLog;
          console.log(`Base RandomnessDelivered epoch ${EPOCH} messageId ${ev.args.messageId} tx ${ev.transactionHash}`);
        }
      }
    }
    const winners = await safe("WinnerDrawn", () =>
      wall.queryFilter(wall.filters.WinnerDrawn(EPOCH), rc!.blockNumber, "latest"));
    if (winners && winners.length) {
      const ev = winners[0] as EventLog;
      const a = ev.args;
      console.log(`Robinhood WinnerDrawn epoch ${EPOCH}: winner ${a.winner} prize ${ethers.formatEther(a.prize)} NOTES randomWord ${a.randomWord}`);
      console.log(`Tx ${ev.transactionHash}`);
      console.log("SETTLEMENT END-TO-END: OK");
      return;
    }
    console.log(`[${new Date().toISOString()}] waiting: requested=${requested} delivered=${delivered}`);
    await sleep(POLL_MS);
  }
  throw new Error("Timed out waiting for WinnerDrawn. Check relay and CCIP status.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
