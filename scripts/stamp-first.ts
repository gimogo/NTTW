import { ethers, network } from "hardhat";

/**
 * One-off: makes the first stamp on IMDRetroWall v3 (Robinhood Chain) so that
 * epoch 1 has at least one ticket. Without a ticket, settlement skips the
 * CCIP/VRF path entirely and proves nothing.
 *
 *   npx hardhat run scripts/stamp-first.ts --network robinhood
 *
 * Approves exactly TOKEN_FEE (1000 NOTES), not unlimited. Aborts before any
 * transaction if the signer holds less than TOKEN_FEE.
 */

// Production wall redeployed 2026-10-16; old wall 0xbD4808f0…2110 is superseded.
const WALL = process.env.WALL_ADDRESS || "0x9550E4F888d1C084CB1C8E74677Da54109723EE3";
const TOKEN = "0x03b76ccf7cfeec5198c81c5844b88a78e68a6173";
const TOKEN_FEE = 1_000_000_000_000_000_000_000n; // 1000e18

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

async function main() {
  if (network.name !== "robinhood") throw new Error(`Run on robinhood, got ${network.name}.`);
  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  if (net.chainId !== 4663n) throw new Error(`Expected chain 4663, got ${net.chainId}.`);

  const token = new ethers.Contract(TOKEN, ERC20_ABI, signer);
  const wall = await ethers.getContractAt("IMDRetroWall", WALL, signer);

  if ((await wall.PAYMENT_TOKEN()).toLowerCase() !== TOKEN.toLowerCase()) {
    throw new Error("Wall PAYMENT_TOKEN does not match NOTES address.");
  }

  const bal: bigint = await token.balanceOf(signer.address);
  const eth = await ethers.provider.getBalance(signer.address);
  console.log(`Signer:  ${signer.address}`);
  console.log(`NOTES:   ${ethers.formatEther(bal)} | ETH: ${ethers.formatEther(eth)}`);
  if (bal < TOKEN_FEE) throw new Error(`Need ${ethers.formatEther(TOKEN_FEE)} NOTES, have ${ethers.formatEther(bal)}. Aborting.`);

  const epochBefore = await wall.currentEpoch();
  console.log(`Current epoch: ${epochBefore}`);

  const allowance: bigint = await token.allowance(signer.address, WALL);
  if (allowance < TOKEN_FEE) {
    const tx = await token.approve(WALL, TOKEN_FEE);
    const rc = await tx.wait();
    console.log(`approve(${ethers.formatEther(TOKEN_FEE)}) tx ${tx.hash} status ${rc!.status}`);
    if (rc!.status !== 1) throw new Error("approve reverted.");
  } else {
    console.log("Allowance already sufficient, skipping approve.");
  }

  const tx = await wall.stampNote("Hello from the first stamp", "#FFD966", 1000, 1000, 0);
  const rc = await tx.wait();
  console.log(`stampNote tx ${tx.hash} status ${rc!.status} block ${rc!.blockNumber}`);
  if (rc!.status !== 1) throw new Error("stampNote reverted.");

  console.log(`Tickets in epoch ${epochBefore}: ${await wall.ticketCount(epochBefore)}`);
  console.log(`Epoch prize: ${ethers.formatEther(await wall.epochPrize(epochBefore))} NOTES`);
  console.log(`Seconds until epoch end: ${await wall.timeUntilEpochEnd()}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
