import "dotenv/config";

import type { HardhatUserConfig } from "hardhat/config";

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
    sepolia: {
      type: "http",
      chainType: "l1",
      url: sepoliaUrl,
      accounts: sepoliaAccounts,
    },
  },
};

export default config;
