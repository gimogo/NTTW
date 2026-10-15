import { ethers, network } from "hardhat";

/**
 * Deploys IMDRetroWall (ERC-721 notes) wired to an existing ERC-20 payment
 * token, then prints everything you need to verify + configure the frontend.
 *
 *   PAYMENT_TOKEN=0x<yourTokenAddress> \
 *     npx hardhat run scripts/deploy.ts --network robinhood      # mainnet
 *   PAYMENT_TOKEN=0x<yourTokenAddress> \
 *     npx hardhat run scripts/deploy.ts --network baseSepolia   # testnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  const paymentToken = process.env.PAYMENT_TOKEN;
  if (!paymentToken || !/^0x[0-9a-fA-F]{40}$/.test(paymentToken)) {
    throw new Error(
      "PAYMENT_TOKEN env var missing. Set it to your ERC-20 token address:\n" +
        "  PAYMENT_TOKEN=0x... npx hardhat run scripts/deploy.ts --network robinhood"
    );
  }

  // Point at something real: the deploy needs code living at PAYMENT_TOKEN.
  const tokenCode = await ethers.provider.getCode(paymentToken);
  if (tokenCode === "0x") {
    console.warn(
      `WARNING: no contract code at PAYMENT_TOKEN ${paymentToken} on ${network.name} yet — ` +
        "the wall deploys fine, but every stampNote() will revert until the token is live."
    );
  }

  console.log("----------------------------------------------------");
  console.log(`Network:  ${network.name} (chain ${await ethers.provider.getNetwork().then((n) => n.chainId)})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH`);
  console.log(`Token:    ${paymentToken}`);
  console.log("----------------------------------------------------");

  const factory = await ethers.getContractFactory("IMDRetroWall");
  const contract = await factory.deploy(paymentToken);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();

  console.log(`IMDRetroWall deployed to: ${address}`);
  if (deployTx) {
    console.log(`Deploy tx:  ${deployTx.hash}`);
  }
  console.log("----------------------------------------------------");
  console.log("Next steps — add to your .env.local (frontend):");
  console.log(`  NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS=${address}`);
  console.log(`  NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=${paymentToken}`);
  console.log("----------------------------------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
