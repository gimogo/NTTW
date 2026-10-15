import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import * as dotenv from "dotenv";
import type { HardhatUserConfig } from "hardhat/config";

dotenv.config();

// Only use the deployer key when one is actually provided.
const accounts = process.env.DEPLOYER_PRIVATE_KEY
  ? [process.env.DEPLOYER_PRIVATE_KEY]
  : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // "paris" keeps bytecode free of PUSH0/MCOPY so the same artifact
      // deploys cleanly on Robinhood Chain and Base Sepolia.
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    // Robinhood Chain — Arbitrum Orbit L2, ETH gas, chain id 4663.
    robinhood: {
      url:
        process.env.ROBINHOOD_RPC_URL ||
        "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts,
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      chainId: 84532,
      accounts,
    },
  },
};

export default config;
