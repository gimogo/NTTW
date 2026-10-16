import { ethers, network } from "hardhat";

/**
 * TEST ONLY — deploys IMDRetroWallShortEpoch (identical to IMDRetroWall v3
 * except EPOCH_DURATION = 10 minutes) on Robinhood Chain, so the full
 * settlement path can be exercised without waiting 7 days.
 *
 *   PAYMENT_TOKEN=0x... npx hardhat run scripts/deploy-test-wall.ts --network robinhood
 *
 * Then wire it the same way as production:
 *   WALL_ADDRESS=0x... npx hardhat run scripts/deploy-relay.ts --network base
 *   WALL_ADDRESS=0x... RELAY_ADDRESS=0x... npx hardhat run scripts/set-relay.ts --network robinhood
 */

// Chainlink CCIP router on Robinhood Chain (chain id 4663).
const CCIP_ROUTER_ROBINHOOD = "0x06fC836cf9839B1cd891C440A0a45242DA6Ae1c9";
// CCIP chain selector of Base mainnet (relay chain).
const BASE_CCIP_SELECTOR = 15971525489660198786n;

async function main() {
  if (network.name !== "robinhood") throw new Error(`Run on robinhood, got ${network.name}.`);
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  const paymentToken = process.env.PAYMENT_TOKEN;
  if (!paymentToken || !/^0x[0-9a-fA-F]{40}$/.test(paymentToken)) {
    throw new Error("PAYMENT_TOKEN env var missing or invalid.");
  }
  if ((await ethers.provider.getCode(paymentToken)) === "0x") {
    throw new Error(`No contract code at PAYMENT_TOKEN ${paymentToken}.`);
  }

  console.log(`Network:  ${network.name} | Deployer: ${deployer.address} | Balance: ${ethers.formatEther(balance)} ETH`);
  console.log(`Token: ${paymentToken} | Router: ${CCIP_ROUTER_ROBINHOOD} | Epoch: 10 minutes (TEST)`);

  const factory = await ethers.getContractFactory("IMDRetroWallShortEpoch");
  const contract = await factory.deploy(paymentToken, CCIP_ROUTER_ROBINHOOD, BASE_CCIP_SELECTOR);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`IMDRetroWallShortEpoch deployed to: ${address}`);
  console.log(`Deploy tx: ${contract.deploymentTransaction()?.hash}`);
  console.log(`Genesis: ${await contract.GENESIS()} | Epoch duration: ${await contract.EPOCH_DURATION()}s`);
  console.log(`Next: WALL_ADDRESS=${address} npx hardhat run scripts/deploy-relay.ts --network base`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
