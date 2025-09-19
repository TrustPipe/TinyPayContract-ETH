import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodeAbiParameters, padHex, parseAbiParameters, sha256 } from "viem";

describe("TinyPay", async () => {
  const { viem, networkHelpers } = await network.connect();
  const { loadFixture } = networkHelpers;
  const [deployer, user, merchant, recipient, paymaster] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  async function deployTinyPayFixture() {
    const contract = await viem.deployContract("TinyPay");
    await contract.write.initSystem([paymaster.account.address, 100n]);
    return { contract };
  }

  async function depositWithTailFixture() {
    const { contract } = await deployTinyPayFixture();
    const depositValue = 1n * 10n ** 18n;
    const opt = padHex("0x01", { size: 32 });
    const tail = sha256(opt);

    await user.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "deposit",
      args: [tail],
      value: depositValue,
    });

    return { contract, depositValue, opt, tail };
  }

  it("allows users to deposit and updates balance/tail", async () => {
    const { contract } = await loadFixture(deployTinyPayFixture);
    const depositValue = 2n * 10n ** 17n; // 0.2 ETH
    const opt = padHex("0xa5", { size: 32 });
    const tail = sha256(opt);

    await user.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "deposit",
      args: [tail],
      value: depositValue,
    });

    const balance = await contract.read.getBalance([user.account.address]);
    assert.equal(balance, depositValue);

    const storedTail = await contract.read.getUserTail([user.account.address]);
    assert.equal(storedTail, tail);

    const stats = await contract.read.getSystemStats();
    assert.equal(stats[0], depositValue);
    assert.equal(stats[1], 0n);
    assert.equal(stats[2], 100n);
  });

  it("supports merchant precommit and payment completion", async () => {
    const { contract, depositValue, opt } = await loadFixture(depositWithTailFixture);

    const amount = depositValue / 2n;
    const payer = user.account.address;
    const receiver = recipient.account.address;

    const fromBlock = await publicClient.getBlockNumber();

    const commitHash = sha256(
      encodeAbiParameters(
        parseAbiParameters("address payer, address recipient, uint256 amount, bytes32 opt"),
        [payer, receiver, amount, opt],
      ),
    );

    await merchant.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "merchantPrecommit",
      args: [commitHash],
    });

    const events = await publicClient.getContractEvents({
      address: contract.address,
      abi: contract.abi,
      eventName: "PreCommitMade",
      fromBlock,
      toBlock: "latest",
    });
    assert.equal(events.length, 1);

    const recipientBalanceBefore = await publicClient.getBalance({ address: receiver });

    await merchant.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "completePayment",
      args: [opt, payer, receiver, amount, commitHash],
    });

    const recipientBalanceAfter = await publicClient.getBalance({ address: receiver });
    const fee = (amount * 100n) / 10000n;

    const balanceAfter = await contract.read.getBalance([payer]);
    assert.equal(balanceAfter, depositValue - amount);

    const tailAfter = await contract.read.getUserTail([payer]);
    assert.equal(tailAfter, opt);

    const stats = await contract.read.getSystemStats();
    assert.equal(stats[1], amount);

    assert.equal(recipientBalanceAfter - recipientBalanceBefore, amount - fee);
  });

  it("lets the paymaster bypass commit validation", async () => {
    const { contract } = await loadFixture(depositWithTailFixture);
    const amount = 1n * 10n ** 17n;
    const newOpt = padHex("0x02", { size: 32 });
    const newTail = sha256(newOpt);

    await user.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "refreshTail",
      args: [newTail],
    });

    await paymaster.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "completePayment",
      args: [newOpt, user.account.address, merchant.account.address, amount, "0x" + "00".repeat(32)],
    });

    const updatedTail = await contract.read.getUserTail([user.account.address]);
    assert.equal(updatedTail, newOpt);
  });

  it("enforces payment limits", async () => {
    const { contract } = await loadFixture(depositWithTailFixture);

    const limit = 5_000_000_000_000_000n; // 0.005 ETH
    await user.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "setPaymentLimit",
      args: [limit],
    });

    const opt = padHex("0x03", { size: 32 });
    const tail = sha256(opt);

    await user.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "refreshTail",
      args: [tail],
    });

    const amount = limit + 1n;
    const commitHash = sha256(
      encodeAbiParameters(
        parseAbiParameters("address payer, address recipient, uint256 amount, bytes32 opt"),
        [user.account.address, merchant.account.address, amount, opt],
      ),
    );

    await merchant.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "merchantPrecommit",
      args: [commitHash],
    });

    await assert.rejects(
      merchant.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "completePayment",
        args: [opt, user.account.address, merchant.account.address, amount, commitHash],
      }),
      { message: /PAYMENT_LIMIT/ },
    );
  });
});
