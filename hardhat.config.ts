import "dotenv/config";

import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-verify";

import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";

const sepoliaUrl = process.env.SEPOLIA_RPC_URL ?? "";
const sepoliaAccounts = [process.env.DEPLOYER_PRIVATE_KEY ?? ""].filter(
  (k): k is string => k.length > 0,
);

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "paris",
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    u2u_testnet:{
      type: "http",
      chainType: "l1",
      url: "https://rpc-nebulas-testnet.uniultra.xyz",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY ?? ""],
      chainId: 2484,
    },
    u2u_mainnet:{
      type: "http",
      chainType: "l1",
      url: "https://rpc-mainnet.u2u.xyz/",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY ?? ""],
      chainId: 39,
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: sepoliaUrl,
      accounts: sepoliaAccounts,
    },
  },
  etherscan: {
    apiKey: {
      u2u_mainnet: "no-api-key-needed",
      u2u_testnet: "no-api-key-needed",
    },
    customChains: [
      {
        network: "u2u_mainnet",
        chainId: 39,
        urls: {
          apiURL: "https://u2uscan.xyz/api",
          browserURL: "https://u2uscan.xyz"
        }
      },
      {
        network: "u2u_testnet",
        chainId: 2484,
        urls: {
          apiURL: "https://testnet.u2uscan.xyz/api",
          browserURL: "https://testnet.u2uscan.xyz"
        }
      }
    ]
  },
  sourcify: {
    enabled: false
  }
} as any;

export default config;
