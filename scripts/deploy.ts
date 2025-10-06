import hre from "hardhat";
import { createWalletClient, createPublicClient, http, defineChain, getContract } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "fs";
import path from "path";

// Define U2U chains
const u2uTestnet = defineChain({
  id: 2484,
  name: "U2U Nebulas Testnet",
  nativeCurrency: { name: "U2U", symbol: "U2U", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc-nebulas-testnet.uniultra.xyz"] },
  },
  blockExplorers: {
    default: { name: "U2U Explorer", url: "https://testnet.u2uscan.xyz" },
  },
});

const u2uMainnet = defineChain({
  id: 39,
  name: "U2U Solaris Mainnet",
  nativeCurrency: { name: "U2U", symbol: "U2U", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc-mainnet.u2u.xyz"] },
  },
  blockExplorers: {
    default: { name: "U2U Explorer", url: "https://u2uscan.xyz" },
  },
});

async function main() {
  // Get network name from command line args
  const networkArg = process.argv.find(arg => arg.startsWith('--network'));
  const networkName = networkArg ? networkArg.split('=')[1] || process.argv[process.argv.indexOf(networkArg) + 1] : 'hardhat';

  // Check if it's a U2U network
  const isU2U = networkName === "u2u_testnet" || networkName === "u2u_mainnet";

  if (isU2U) {
    // Use direct viem for U2U networks
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("DEPLOYER_PRIVATE_KEY not set");
    }

    const chain = networkName === "u2u_testnet" ? u2uTestnet : u2uMainnet;
    const rpcUrl = networkName === "u2u_testnet" 
      ? "https://rpc-nebulas-testnet.uniultra.xyz"
      : "https://rpc-mainnet.u2u.xyz/";
    
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    console.log("Deploying with:", account.address);

    // Get contract artifact
    const artifactPath = path.join(hre.config.paths.artifacts, "contracts/TinyPay.sol/TinyPay.json");
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

    // Deploy contract
    const hash = await walletClient.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode as `0x${string}`,
      account,
      args: [],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const address = receipt.contractAddress!;
    console.log("TinyPay deployed at:", address);

    // Initialize system
    const paymaster = (process.env.PAYMASTER || account.address) as `0x${string}`;
    const feeRate = BigInt(process.env.FEE_BPS || "100");

    const contract = getContract({
      address,
      abi: artifact.abi,
      client: { public: publicClient, wallet: walletClient },
    });

    const initHash = await contract.write.initSystem([paymaster, feeRate]);
    await publicClient.waitForTransactionReceipt({ hash: initHash });

    const paymasterResult = await contract.read.paymaster([]);
    console.log("initSystem done. paymaster=", paymasterResult);
  } else {
    // Use hardhat-viem for other networks
    const { viem } = await hre.network.connect();
    const [deployer] = await viem.getWalletClients();

    console.log("Deploying with:", deployer.account.address);

    const contract = await viem.deployContract("TinyPay");
    const address = contract.address;
    console.log("TinyPay deployed at:", address);

    const paymaster = (process.env.PAYMASTER || deployer.account.address) as `0x${string}`;
    const feeRate = BigInt(process.env.FEE_BPS || "100");

    const txHash = await contract.write.initSystem([paymaster, feeRate]);
    const publicClient = await viem.getPublicClient();
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    const paymasterResult2 = await contract.read.paymaster();
    console.log("initSystem done. paymaster=", paymasterResult2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
