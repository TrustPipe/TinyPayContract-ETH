import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const TinyPayModule = buildModule("TinyPayModule", (m) => {
  const tinypay = m.contract("TinyPay");

  const feeRate = Number(process.env.FEE_BPS ?? 100);
  const paymasterEnv = process.env.PAYMASTER?.trim();
  const paymasterAddress = paymasterEnv && paymasterEnv.length > 0 ? paymasterEnv : m.getAccount(0);

  m.call(tinypay, "initSystem", [paymasterAddress, feeRate]);

  return { tinypay };
});

export default TinyPayModule;
