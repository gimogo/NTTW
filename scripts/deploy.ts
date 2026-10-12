import { ethers, network } from "hardhat";

/**
 * Deploys IMDRetroWall (ERC-721 notes) and prints the env var you need for the frontend.
 *
 *   npx hardhat run scripts/deploy.ts --network baseSepolia
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("----------------------------------------------------");
  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH`);
  console.log("----------------------------------------------------");

  const factory = await ethers.getContractFactory("IMDRetroWall");
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();

  console.log(`IMDRetroWall deployed to: ${address}`);
  if (deployTx) {
    console.log(`Deploy tx:  ${deployTx.hash}`);
  }
  console.log("----------------------------------------------------");
  console.log("Next steps — add to your .env.local:");
  console.log(`  NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS=${address}`);
  console.log("----------------------------------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
