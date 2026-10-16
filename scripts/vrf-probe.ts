import { ethers, network } from "hardhat";

/**
 * TEST / DIAGNOSTIC — isolates the VRF fulfiller from the CCIP relay.
 *
 *   npx hardhat run scripts/vrf-probe.ts --network base
 *
 * Creates a NEW subscription, funds it with native ETH, adds the EOA as a
 * consumer, and requests one random word directly from the EOA. If this
 * fulfills quickly while a relay-mediated request on the same lane hangs,
 * the problem is subscription/consumer related, not lane related.
 */

const VRF_COORDINATOR_BASE = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";
// 30 gwei lane on Base mainnet.
const KEY_HASH_30GWEI = "0xdc2f87677b01473c763cb0aee938ed3341512f6057324a584e5944e786144d70";
const SUB_FUND = ethers.parseEther(process.env.SUB_FUND_ETH || "0.0002");

const VRF_ABI = [
  "function createSubscription() returns (uint256 subId)",
  "function fundSubscriptionWithNative(uint256 subId) payable",
  "function addConsumer(uint256 subId, address consumer)",
  "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] consumers)",
  "event SubscriptionCreated(uint256 indexed subId, address owner)",
];

async function main() {
  if (network.name !== "base") throw new Error(`Run on base, got ${network.name}.`);
  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);
  console.log(`Deployer: ${signer.address} | ETH: ${ethers.formatEther(balance)}`);
  if (balance < SUB_FUND + ethers.parseEther("0.0003")) {
    throw new Error("Not enough ETH for funding + gas.");
  }

  const vrf = new ethers.Contract(VRF_COORDINATOR_BASE, VRF_ABI, signer);

  const createTx = await vrf.createSubscription();
  const createRcpt = await createTx.wait();
  const ev = createRcpt!.logs
    .map((l: any) => { try { return vrf.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e && e.name === "SubscriptionCreated");
  const subId: bigint = ev!.args.subId;
  console.log(`Sub baru: ${subId} (tx ${createTx.hash})`);

  const fundTx = await vrf.fundSubscriptionWithNative(subId, { value: SUB_FUND });
  await fundTx.wait();
  console.log(`Sub didanai ${ethers.formatEther(SUB_FUND)} ETH (tx ${fundTx.hash})`);

  const addTx = await vrf.addConsumer(subId, signer.address);
  await addTx.wait();
  console.log(`Consumer EOA ditambahkan (tx ${addTx.hash})`);

  // extraArgs: abi.encode(uint8(1)) → native payment; last byte = 1.
  const extraArgs = ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [1]);
  const req = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bytes32,uint256,uint16,uint32,uint32,bytes)"],
    [[KEY_HASH_30GWEI, subId, 3, 200_000, 1, extraArgs]]
  );

  const VRF_REQ_ABI = ["function requestRandomWords((bytes32,uint256,uint16,uint32,uint32,bytes)) returns (uint256 requestId)"];
  const vrfReq = new ethers.Contract(VRF_COORDINATOR_BASE, VRF_REQ_ABI, signer);
  const reqTx = await vrfReq.requestRandomWords(req);
  const reqRcpt = await reqTx.wait();
  console.log(`requestRandomWords tx ${reqTx.hash} status ${reqRcpt!.status}`);
  const reqEvent = reqRcpt!.logs
    .map((l: any) => { try { return vrfReq.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e && e.name === "RandomWordsRequested");
  if (reqEvent) console.log(`requestId: ${reqEvent.args.requestId}`);

  console.log("DONE — pantau RandomWordsFulfilled untuk requestId di atas.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
