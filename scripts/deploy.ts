import { ethers, network } from "hardhat";

/**
 * Stage 1 of 3 — deploys IMDRetroWall v3 on Robinhood Chain.
 *
 *   PAYMENT_TOKEN=0x... npx hardhat run scripts/deploy.ts --network robinhood
 *
 * Then:
 *   Stage 2: scripts/deploy-relay.ts on Base (needs WALL_ADDRESS)
 *   Stage 3: scripts/set-relay.ts on Robinhood (needs RELAY_ADDRESS)
 */

// Chainlink CCIP router on Robinhood Chain (chain id 4663).
const CCIP_ROUTER_ROBINHOOD = "0x06fC836cf9839B1cd891C440A0a45242DA6Ae1c9";
// CCIP chain selector of Base mainnet (relay chain).
const BASE_CCIP_SELECTOR = 15971525489660198786n;

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  const paymentToken = process.env.PAYMENT_TOKEN;
  if (!paymentToken || !/^0x[0-9a-fA-F]{40}$/.test(paymentToken)) {
    throw new Error("PAYMENT_TOKEN env var missing or invalid.");
  }
  const tokenCode = await ethers.provider.getCode(paymentToken);
  if (tokenCode === "0x") {
    throw new Error(`No contract code at PAYMENT_TOKEN ${paymentToken} on ${network.name}.`);
  }

  console.log("----------------------------------------------------");
  console.log(`Network:  ${network.name} (chain ${(await ethers.provider.getNetwork()).chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH`);
  console.log(`Token:    ${paymentToken}`);
  console.log(`Router:   ${CCIP_ROUTER_ROBINHOOD}`);
  console.log(`Relay chain selector (Base): ${BASE_CCIP_SELECTOR}`);
  console.log("----------------------------------------------------");

  const factory = await ethers.getContractFactory("IMDRetroWall");
  const contract = await factory.deploy(paymentToken, CCIP_ROUTER_ROBINHOOD, BASE_CCIP_SELECTOR);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();
  console.log(`IMDRetroWall v3 deployed to: ${address}`);
  if (deployTx) console.log(`Deploy tx:  ${deployTx.hash}`);
  console.log("----------------------------------------------------");
  console.log(`Next: WALL_ADDRESS=${address} npx hardhat run scripts/deploy-relay.ts --network base`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
