import { ethers } from "hardhat";
/**
 * READ-ONLY settlement preflight — sends nothing, resolves the signer only for
 * its public address, and never logs a private key. Use before every settle run.
 *   npx hardhat run scripts/preflight-settle.ts --network robinhood
 */

/**
 * Read-only preflight for the epoch-1 production settlement. Sends nothing.
 *   npx hardhat run scripts/preflight-settle.ts --network robinhood
 */

const BASE_RPC = "https://mainnet.base.org";
const RH_RPC = "https://rpc.mainnet.chain.robinhood.com";
const WALL = "0x9550E4F888d1C084CB1C8E74677Da54109723EE3";
const RELAY = "0x887bbed753938087Ce61Ca768a358848177E6eaA";
const VRFC_BASE = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";

const statusName = (s: bigint) => (s === 0n ? "None" : s === 1n ? "Requested" : s === 2n ? "Settled" : `?(${s})`);

async function main() {
  const [signer] = await ethers.getSigners();
  const rh = new ethers.JsonRpcProvider(RH_RPC);
  const base = new ethers.JsonRpcProvider(BASE_RPC);

  const rhBal = await rh.getBalance(signer.address);
  const baseBal = await base.getBalance(signer.address);
  console.log(`[wallet] ${signer.address}`);
  console.log(`[wallet] Robinhood(4663): ${ethers.formatEther(rhBal)} ETH`);
  console.log(`[wallet] Base(8453):      ${ethers.formatEther(baseBal)} ETH`);

  const wall = new ethers.Contract(WALL, [
    "function currentEpoch() view returns (uint256)",
    "function timeUntilEpochEnd() view returns (uint256)",
    "function settlementStatus(uint256) view returns (uint8)",
    "function ticketCount(uint256) view returns (uint256)",
    "function epochPrize(uint256) view returns (uint256)",
    "function relay() view returns (address)",
  ], rh);

  const cur = await wall.currentEpoch();
  const secondsLeft = await wall.timeUntilEpochEnd();
  const status = await wall.settlementStatus(1);
  const tickets = await wall.ticketCount(1);
  const prize = await wall.epochPrize(1);
  const wallRelay = await wall.relay();
  const epochEnded = cur > 1n || secondsLeft === 0n;

  console.log(`[wall] currentEpoch=${cur} timeUntilEpochEnd=${secondsLeft}s — epoch 1 ${epochEnded ? "ENDED" : "STILL OPEN"}`);
  console.log(`[wall] epoch1 settlementStatus=${statusName(status)} ticketCount=${tickets} epochPrize=${ethers.formatEther(prize)} NOTES`);
  console.log(`[wall] wall.relay()=${wallRelay} ${wallRelay.toLowerCase() === RELAY.toLowerCase() ? "(matches relay)" : "(MISMATCH!)"}`);

  const rel = new ethers.Contract(RELAY, [
    "function SUBSCRIPTION_ID() view returns (uint256)",
    "function randomnessReady(uint256) view returns (bool)",
    "function delivered(uint256) view returns (bool)",
  ], base);
  const [subId, ready, delivered] = [await rel.SUBSCRIPTION_ID(), await rel.randomnessReady(1n), await rel.delivered(1n)];
  console.log(`[relay] randomnessReady(1)=${ready} delivered(1)=${delivered}`);
  console.log(`[relay] ETH balance: ${ethers.formatEther(await base.getBalance(RELAY))} ETH`);

  const vrf = new ethers.Contract(VRFC_BASE, [
    "function getSubscription(uint256) view returns (uint96,uint96,uint64,address,address[])",
  ], base);
  const sub = await vrf.getSubscription(subId);
  console.log(`[vrf] sub ${subId} native=${ethers.formatEther(sub[1])} ETH reqCount=${sub[2]} consumers=${sub[4].join(",")} owner=${sub[3]}`);

  if (!epochEnded) {
    console.log(`[STOP] Epoch 1 has NOT ended — exactly ${secondsLeft} seconds left (~${Math.round(Number(secondsLeft) / 60)} min). Nothing to send.`);
    return;
  }
  console.log(`[ok] epoch 1 ended; next step depends on settlementStatus(1): ${statusName(status)}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
