import { ethers, network } from "hardhat";

/**
 * Stage 3 of 3 — links the wall to the relay. One-time, deployer-only.
 *
 *   WALL_ADDRESS=0x... RELAY_ADDRESS=0x... npx hardhat run scripts/set-relay.ts --network robinhood
 */
async function main() {
  const wall = process.env.WALL_ADDRESS;
  const relay = process.env.RELAY_ADDRESS;
  if (!wall || !/^0x[0-9a-fA-F]{40}$/.test(wall)) throw new Error("WALL_ADDRESS env var missing or invalid.");
  if (!relay || !/^0x[0-9a-fA-F]{40}$/.test(relay)) throw new Error("RELAY_ADDRESS env var missing or invalid.");

  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name} | deployer ${deployer.address} | wall ${wall} | relay ${relay}`);

  const wallContract = await ethers.getContractAt("IMDRetroWall", wall, deployer);
  const tx = await wallContract.setRelay(relay);
  const rcpt = await tx.wait();
  console.log(`setRelay tx: ${tx.hash} (status ${rcpt?.status})`);
  console.log(`wall.relay() = ${await wallContract.relay()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
