import { ethers } from "hardhat";

// Production pair redeployed 2026-10-16 (the first production relay lacked ERC-165).
// Superseded pair: 0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110 (both chains).
const WALL = "0x9550E4F888d1C084CB1C8E74677Da54109723EE3";
const RELAY = "0x887bbed753938087Ce61Ca768a358848177E6eaA";
const ROBINHOOD_RPC = "https://rpc.mainnet.chain.robinhood.com";
const BASE_RPC = "https://mainnet.base.org";
const VRF_COORDINATOR_BASE = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";

async function main() {
  const rh = new ethers.JsonRpcProvider(ROBINHOOD_RPC);
  const base = new ethers.JsonRpcProvider(BASE_RPC);

  console.log("wall code (Robinhood):", (await rh.getCode(WALL)).length > 2 ? "present" : "MISSING");
  console.log("relay code (Base):", (await base.getCode(RELAY)).length > 2 ? "present" : "MISSING");

  const wall = new ethers.Contract(
    WALL,
    [
      "function relay() view returns (address)",
      "function RELAY_CHAIN_SELECTOR() view returns (uint64)",
      "function CCIP_ROUTER() view returns (address)",
      "function PAYMENT_TOKEN() view returns (address)",
    ],
    rh
  );
  console.log("wall.relay():", await wall.relay());
  console.log("wall.RELAY_CHAIN_SELECTOR():", (await wall.RELAY_CHAIN_SELECTOR()).toString());
  console.log("wall.CCIP_ROUTER():", await wall.CCIP_ROUTER());
  console.log("wall.PAYMENT_TOKEN():", await wall.PAYMENT_TOKEN());

  const relay = new ethers.Contract(
    RELAY,
    [
      "function WALL() view returns (address)",
      "function WALL_CHAIN_SELECTOR() view returns (uint64)",
      "function SUBSCRIPTION_ID() view returns (uint256)",
      "function KEY_HASH() view returns (bytes32)",
      "function CCIP_ROUTER() view returns (address)",
    ],
    base
  );
  const subId: bigint = await relay.SUBSCRIPTION_ID();
  console.log("relay.WALL():", await relay.WALL());
  console.log("relay.WALL_CHAIN_SELECTOR():", (await relay.WALL_CHAIN_SELECTOR()).toString());
  console.log("relay.CCIP_ROUTER():", await relay.CCIP_ROUTER());
  console.log("relay.KEY_HASH():", await relay.KEY_HASH());
  console.log("relay.SUBSCRIPTION_ID():", subId.toString());
  console.log("relay ETH balance:", ethers.formatEther(await base.getBalance(RELAY)));

  const vrf = new ethers.Contract(
    VRF_COORDINATOR_BASE,
    [
      "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] consumers)",
    ],
    base
  );
  const sub = await vrf.getSubscription(subId);
  console.log("VRF sub nativeBalance:", ethers.formatEther(sub.nativeBalance));
  console.log("VRF sub consumers:", sub.consumers);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
