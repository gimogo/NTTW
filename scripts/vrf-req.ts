import { ethers, network } from "hardhat";

/**
 * TEST / DIAGNOSTIC — minimal VRF v2.5 request straight from the EOA.
 *
 *   npx hardhat run scripts/vrf-req.ts --network base
 *
 * Assumes the target subscription already exists, is funded with native ETH,
 * and has the EOA registered as consumer (prepared by scripts/vrf-probe.ts or
 * via SUB_ID env from a prior run).
 */

const VRF_COORDINATOR_BASE = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";const KEY_HASH_30GWEI = "0xdc2f87677b01473c763cb0aee938ed3341512f6057324a584e5944e786144d70";
const KEY_HASH_2GWEI = "0x00b81b5a830cb0a4009fbd8904de511e28631e62ce5ad231373d3cdad373ccab";
const SUB_ID = process.env.SUB_ID;
const CONFIRMATIONS = process.env.CONF ? Number(process.env.CONF) : 3;
const GAS_LIMIT = process.env.GL ? Number(process.env.GL) : 200_000;
const NUM_WORDS = process.env.NW ? Number(process.env.NW) : 1;
const LANE = process.env.LANE === "2" ? KEY_HASH_2GWEI : process.env.LANE === "30" ? KEY_HASH_30GWEI : null;

async function main() {
  if (network.name !== "base") throw new Error(`Run on base, got ${network.name}.`);
  if (!SUB_ID || !/^\d+$/.test(SUB_ID)) throw new Error("SUB_ID env var missing (decimal subscription id).");
  if (!LANE) throw new Error("LANE env var must be 2 or 30.");
  const [signer] = await ethers.getSigners();
  console.log(`Requester: ${signer.address} | sub: ${SUB_ID} | lane: ${process.env.LANE} gwei | conf: ${CONFIRMATIONS} | gas: ${GAS_LIMIT} | words: ${NUM_WORDS}`);

  // Must be tagged: selector("VRF ExtraArgsV1") ++ abi.encode((bool nativePayment))
  // The coordinator reverts with InvalidExtraArgsTag() otherwise.
  const tag = ethers.id("VRF ExtraArgsV1").slice(0, 10); // bytes4
  const extraArgs = tag + ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [true]).slice(2); // nativePayment = true
  const abi = [
    "function requestRandomWords((bytes32,uint256,uint16,uint32,uint32,bytes)) returns (uint256 requestId)",
    "function getSubscription(uint256) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] consumers)",
  ];
  const vrfReq = new ethers.Contract(VRF_COORDINATOR_BASE, abi, signer);

  // The on-chain signature takes ONE tuple; build it as a plain JS array.
  const reqTx = await vrfReq.requestRandomWords([LANE, BigInt(SUB_ID), CONFIRMATIONS, GAS_LIMIT, NUM_WORDS, extraArgs]);
  const rc = await reqTx.wait();
  console.log(`requestRandomWords tx ${reqTx.hash} status ${rc!.status}`);
  const ev = rc!.logs
    .map((l: any) => { try { return vrfReq.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e && e.name === "RandomWordsRequested");
  if (ev) console.log(`requestId: ${ev.args.requestId.toString()}`);
  const sub = await vrfReq.getSubscription(BigInt(SUB_ID));
  console.log(`Sub saldo: ${ethers.formatEther(sub.nativeBalance)} ETH | reqCount: ${sub.reqCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
