import { ethers, network } from "hardhat";

/**
 * Stage 2 of 3 — deploys VrfCcipRelay on Base mainnet.
 *
 *   WALL_ADDRESS=0x... npx hardhat run scripts/deploy-relay.ts --network base
 *
 * Creates a native-ETH-funded VRF v2.5 subscription, deploys the relay, adds it
 * as the subscription's consumer, and sends ETH to the relay for CCIP fees.
 * Amounts are env-configurable; defaults fit a small Base balance.
 */

// Chainlink VRF v2.5 coordinator on Base mainnet.
const VRF_COORDINATOR_BASE = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";
// Key hashes registered for Base mainnet VRF v2.5 (see docs.chain.link VRF v2.5
// supported networks). VRF_KEY_HASH can override, e.g. the 30 gwei lane:
//   0xdc2f87677b01473c763cb0aee938ed3341512f6057324a584e5944e786144d70
// The coordinator does NOT validate key hashes: an unregistered/unfulfilled
// lane accepts requests but they are never fulfilled.
const VRF_KEY_HASH_BASE = ethers.isBytesLike(process.env.VRF_KEY_HASH || "")
  ? process.env.VRF_KEY_HASH!
  : "0x00b81b5a830cb0a4009fbd8904de511e28631e62ce5ad231373d3cdad373ccab";
// Reuse an existing subscription? Pass VRF_SUB_ID to skip creation and funding.
const EXISTING_SUB_ID = process.env.VRF_SUB_ID && /^\d+$/.test(process.env.VRF_SUB_ID)
  ? BigInt(process.env.VRF_SUB_ID)
  : null;
// Chainlink CCIP router on Base mainnet.
const CCIP_ROUTER_BASE = "0x881e3A65B4d4a04dD529061dd0071cf975F58bCD";
// CCIP chain selector of Robinhood Chain (the wall chain).
const ROBINHOOD_CCIP_SELECTOR = 6180753054346818345n;

const VRF_ABI = [
  "function createSubscription() returns (uint256 subId)",
  "function fundSubscriptionWithNative(uint256 subId) payable",
  "function addConsumer(uint256 subId, address consumer)",
  "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] consumers)",
  "event SubscriptionCreated(uint256 indexed subId, address owner)",
];

async function main() {
  const wall = process.env.WALL_ADDRESS;
  if (!wall || !/^0x[0-9a-fA-F]{40}$/.test(wall)) throw new Error("WALL_ADDRESS env var missing or invalid.");

  const subFund = ethers.parseEther(process.env.VRF_SUB_FUND_ETH || "0.0002");
  const relayFund = ethers.parseEther(process.env.RELAY_FEE_FUND_ETH || "0.0002");

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const net = await ethers.provider.getNetwork();
  if (net.chainId !== 8453n) throw new Error(`Expected Base mainnet (8453), got ${net.chainId}.`);

  console.log("----------------------------------------------------");
  console.log(`Network:  ${network.name} (chain ${net.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH`);
  console.log(`Wall:     ${wall} (Robinhood selector ${ROBINHOOD_CCIP_SELECTOR})`);
  console.log(`VRF sub funding: ${ethers.formatEther(subFund)} ETH | relay CCIP fee funding: ${ethers.formatEther(relayFund)} ETH`);
  console.log("----------------------------------------------------");

  const vrf = new ethers.Contract(VRF_COORDINATOR_BASE, VRF_ABI, deployer);

  let subId: bigint;
  if (EXISTING_SUB_ID !== null) {
    subId = EXISTING_SUB_ID;
    console.log(`Reusing VRF subscription: ${subId}`);
  } else {
    const createTx = await vrf.createSubscription();
    const createRcpt = await createTx.wait();
    const subEvent = createRcpt!.logs
      .map((l: any) => {
        try {
          return vrf.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e: any) => e && e.name === "SubscriptionCreated");
    subId = subEvent!.args.subId;
    console.log(`VRF subscription created: ${subId} (tx ${createTx.hash})`);

    const fundTx = await vrf.fundSubscriptionWithNative(subId, { value: subFund });
    await fundTx.wait();
    console.log(`Subscription funded with native ETH (tx ${fundTx.hash})`);
  }

  const factory = await ethers.getContractFactory("VrfCcipRelay");
  const relay = await factory.deploy(
    VRF_COORDINATOR_BASE,
    subId,
    VRF_KEY_HASH_BASE,
    CCIP_ROUTER_BASE,
    ROBINHOOD_CCIP_SELECTOR,
    wall
  );
  await relay.waitForDeployment();
  const relayAddress = await relay.getAddress();
  console.log(`VrfCcipRelay deployed to: ${relayAddress} | keyHash: ${VRF_KEY_HASH_BASE}`);

  const addTx = await vrf.addConsumer(subId, relayAddress);
  await addTx.wait();
  console.log(`Relay added as VRF consumer (tx ${addTx.hash})`);

  const feeTx = await deployer.sendTransaction({ to: relayAddress, value: relayFund });
  await feeTx.wait();
  console.log(`Relay funded with ${ethers.formatEther(relayFund)} ETH for CCIP fees (tx ${feeTx.hash})`);

  console.log("----------------------------------------------------");
  console.log(`Next: RELAY_ADDRESS=${relayAddress} npx hardhat run scripts/set-relay.ts --network robinhood`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
