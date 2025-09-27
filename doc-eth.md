**TinyPay (Ethereum) 合约使用说明**

---
合约源：`contracts/TinyPay.sol`  
部署网络：Sepolia 测试网  
部署地址：`0xfEAE0653D8FfA8fbCd23A3410F10CEdeFD56db0a`  
ABI：`artifacts/contracts/TinyPay.sol/TinyPay.json` 的 `abi` 字段

---

### 1. 设计概览
- 开发语言：Solidity `^0.8.21`  
- 账户模型：以太坊原生 `address`，内部以 `mapping(address => UserAccount)` 存储余额与 tail 状态。  
- 货币单位：ETH（合约持有者用于支付和提现）；手续费留在合约内，可由 `admin` 提现。  
- Hash 算法：沿用原 Move 版逻辑，都使用 `sha256`。  
  - `tail = sha256(opt)`  
  - `commitHash = sha256(abi.encode(payer, recipient, amount, opt))`  
  - paymaster 可绕过 `commitHash` 校验（传任意 `bytes32`，如全 0）。

---

### 2. 关键结构 & 状态

```solidity
struct UserAccount {
    uint256 balance;        // 合约内存放的 ETH 余额（wei）
    bytes32 tail;           // 当前 tail（即 hash）
    uint64  paymentLimit;   // 单笔支付限额（0 = 不限制）
    uint64  tailUpdateCount;
    uint64  maxTailUpdates; // tail 最大更新次数（0 = 不限制）
}

struct PreCommit {
    address merchant;
    uint64  expiryTime;     // 区块时间 + 15 分钟
}
```

- `TinyPay` 合约内的状态：
  - `totalDeposits`, `totalWithdrawals`, `feeRate`（基点制，100 = 1%）
  - `admin`（部署者），`paymaster`（默认 admin，可改）
  - `precommits`：`mapping(bytes32 => PreCommit)`  
- 所有事件与 Move 版等价（命名延用原版本）：`DepositMade`, `PreCommitMade`, `PaymentCompleted`, `FundsWithdrawn` 等。

---

### 3. 公开方法对照

| 操作 | Solidity 函数 | 参数/说明 |
| ---- | ------------- | --------- |
| 初始化 | `initSystem(address paymaster, uint64 feeRate)` | 部署后调用一次，设置 admin=调用者。Ignition 脚本已自动执行。 |
| 充值 | `deposit(bytes32 tail)` payable | 如果账户不存在自动初始化；充值数额通过 `msg.value`。`tail` 非 `0` 且不同于当前值时累加 `tailUpdateCount`。 |
| 追加余额 | `addFunds()` payable | 与 `deposit` 除 tail 逻辑外一致。 |
| 预提交 | `merchantPrecommit(bytes32 commitHash)` | 记录 15 分钟有效的 `commitHash`。 |
| 完成支付 | `completePayment(bytes32 opt, address payer, address recipient, uint256 amount, bytes32 commitHash)` | 若调用者 != paymaster：校验 `sha256(abi.encode(...))` 与预提交记录，过期或不存在即 revert。校验 `sha256(opt)` 等于当前 `tail`。扣手续费后向 `recipient` 转 ETH。将 `tail` 更新为 `opt`。`tailUpdateCount` 自增。 |
| 设置限额 | `setPaymentLimit(uint64 limit)` / `setTailUpdatesLimit(uint64 limit)` | 0 = 不限制。 |
| 刷新 tail | `refreshTail(bytes32 newTail)` | 手动更新 tail（会执行限次检查）。 |
| 提现 | `withdrawFunds(uint256 amount)` | 将余额从合约转回用户钱包。 |
| 提现手续费 | `withdrawFee(address payable to, uint256 amount)` | admin 专用。 |
| 改费率 | `updateFeeRate(uint64 newFeeRate)` | admin 专用。 |
| 改 paymaster | `setPaymaster(address newPaymaster)` | admin 专用。 |
| 视图函数 | `getBalance(address)`, `getUserTail(address)`, `getUserLimits(address)`, `getSystemStats()`, `isAccountInitialized(address)`, `getVaultAddress()` | 与 Move 版一一对应；`getVaultAddress()` 返回合约地址。 |

---

### 4. Aptos → Ethereum 差异点

| 领域 | Aptos Move | Ethereum Solidity |
| ---- | ----------- | ----------------- |
| 资产类型 | APT (AptosCoin) | ETH (或可扩展到 ERC-20) |
| 哈希编码 | `vector<u8>` (ASCII hex) | `bytes32` raw hash；客户端需自行处理 hex ↔ bytes32 |
| 预提交表 | `aptos_std::table` | `mapping(bytes32 => PreCommit)` |
| 时间 | `timestamp::now_seconds()` | `block.timestamp` |
| 费用账户 | 资源账号 signer capability | 合约自身 `address(this)` 持有并转账 |
| 权限 | `admin`, `paymaster` | 同逻辑，函数权限由 `require(msg.sender == admin)` 控制 |
| 错误码 | `assert!(…, E_XXX)` | `require`/`revert` 字符串，如 `PAYMENT_LIMIT` |

---

### 5. 对接说明

#### 前端（React/wagmi 或其它）
- 使用部署地址 + ABI 实例化合约。
- 充值：`deposit(tail)`，附 `value`；其中 `tail = sha256(opt)`（`opt` 需为 32 字节）。
- 支付：
  1. 客户端或后端计算 `commitHash = sha256(abi.encode(payer, recipient, amount, opt))`。
  2. 商户地址执行 `merchantPrecommit(commitHash)`.
  3. `completePayment(opt, payer, recipient, amount, commitHash)`。
- Paymaster 通道：paymaster 地址调用 `completePayment` 时，`commitHash` 可传全 0。  
- 事件监听：`DepositMade`, `PreCommitMade`, `PaymentCompleted` 等都带有必要字段。

#### 后端（Node/Go 等）
- 与 Move 版一致地管理 hash 链、限额与 tail。  
- 可使用 `viem`/`ethers`：  
  ```ts
  const opt = padHex('0x....', { size: 32 });
  const tail = sha256(opt);
  const commitHash = sha256(
    encodeAbiParameters(
      parseAbiParameters('address payer, address recipient, uint256 amount, bytes32 opt'),
      [payer, recipient, amount, opt]
    )
  );
  ```
- 建议对 `PaymentCompleted` 等事件做监听，用于账务对帐。

---

### 6. 当前部署状态（2025-09-18）
- 手动流程已跑一次：  
  - 初始余额 0.08 ETH → 支付 0.03 ETH（merchant） → 支付 0.01 ETH（paymaster bypass） → 提现 0.015 ETH。  
  - 合约内 `UserAccount.balance` 现为 0.025 ETH；链上可 `withdrawFunds` 取回。  
  - 手续费累积约 0.0004 ETH，`admin` 之后可 `withdrawFee`。  
- 最近一次整套流程记录：`scripts/runFlow.ts`（包含等待交易确认逻辑）。

---

### 7. 风险与 TODO
1. **哈希不一致风险**：确保所有客户端与后端都使用 `sha256`、`abi.encode` 顺序一致；否则 `commitHash` 或 `tail` 校验会失败。  
2. **ETH 价格波动**：若需要稳定币，可后续扩展为 ERC-20 版本；目前合约针对 ETH。  
3. **手续费管理**：管理员需定期调用 `withdrawFee` 将手续费转出；或稍后加自动分账逻辑。  
4. **安全性**：合约无管理员功能可移除用户资金，但管理员应使用多签控制 `updateFeeRate`/`setPaymaster`/`withdrawFee`。  
5. **测试账户资金**：部署者钱包仍剩余约 `0.0199 ETH`，可从 Sepolia faucet 补充后继续测试。

---

### 8. 参考脚本
- `scripts/runFlow.ts`：自动执行“充值→预提交→支付→paymaster→提现”，可直接复现链上流程。  
- `scripts/checkState.ts`：查询当前账户余额、tail 与系统统计。  
- 测试：`npm test` 运行 Hardhat Solidity + viem’s `node:test` 套件，覆盖核心逻辑。

---

如需切换网络、改币种或集成新的 hash 策略，可基于此版本继续迭代。建议前后端先用 Sepolia 环境联调，确认流程无误后再考虑主网部署。
