# TinyPay - Ethereum Payment Contract

A secure and efficient payment contract system built on Ethereum-compatible chains, featuring OTP-based authentication and multi-token support.

## Overview

TinyPay is a smart contract payment solution that enables:
- **OTP-based payments**: Secure transactions using one-time password verification
- **Multi-token support**: Native ETH and ERC20 token payments
- **Merchant precommit**: Optional payment commitment mechanism
- **Fee management**: Configurable transaction fees with paymaster support
- **Account limits**: Customizable payment and tail update limits

## Deployed Contracts

### U2U Solaris Mainnet
- **Contract Address**: `0x4690cb265Bc3C12fD218670DfBDC4571d2C5a6B5`
- **Chain ID**: 39
- **Explorer**: [View on U2UScan](https://u2uscan.xyz/address/0x4690cb265Bc3C12fD218670DfBDC4571d2C5a6B5)
- **Paymaster**: `0xEBcddFf6ECD3c3Ddc542a5DCB109ADd04b1eB7e9`
- **Fee Rate**: 100 bps (1%)
- **Supported Tokens**:
  - Native U2U: `0x0000000000000000000000000000000000000000`
  - pUSDC: `0x665f693241e680c4171F01d90AbEa500af42F9FF`
  - pUSDT: `0x0820957B320E901622385Cc6C4fca196b20b939F`

### U2U Nebulas Testnet
- **Contract Address**: `0x1f29403dfc25bd57231e4ad62092baf3e44fb89d`
- **Chain ID**: 2484
- **Explorer**: [View on Testnet Explorer](https://testnet.u2uscan.xyz/address/0x1f29403dfc25bd57231e4ad62092baf3e44fb89d)

## Quick Start

### Prerequisites

```bash
npm install
```

### Environment Setup

Create a `.env` file:

```env
DEPLOYER_PRIVATE_KEY=your_private_key_here
PAYMASTER=0xYourPaymasterAddress  # Optional, defaults to deployer
FEE_BPS=100  # Optional, defaults to 100 (1%)
```

### Deployment

#### Deploy to U2U Mainnet

```bash
npx hardhat run scripts/deploy.ts --network u2u_mainnet
```

#### Deploy to U2U Testnet

```bash
npx hardhat run scripts/deploy.ts --network u2u_testnet
```

### Contract Verification

Due to U2U's custom EVM configuration, automated verification is not supported. Use manual verification:

1. Visit the contract on [U2UScan](https://u2uscan.xyz)
2. Navigate to "Contract" → "Verify & Publish"
3. Use these settings:
   - **Compiler**: `v0.8.30`
   - **EVM Version**: `paris` (important!)
   - **Optimization**: Enabled, Runs: `200`
   - **Via IR**: Enabled

Alternatively, use the verification script:

```bash
npx tsx scripts/verify-u2u.ts <contract-address>
```

## Key Features

### OTP-Based Payments

Payments are secured using a hash chain mechanism:
1. User deposits funds with an initial tail (OTP hash)
2. To complete payment, user provides the OTP
3. System verifies `sha256(OTP) == tail`
4. New tail is set to the OTP for next payment

### Merchant Precommit

Merchants can create payment commitments:
```solidity
merchantPrecommit(token, payer, recipient, amount, otp)
```

This creates a 15-minute window for payment completion with verified parameters.

### Multi-Token Support

Admin can add ERC20 token support:
```bash
cast send $CONTRACT "addCoinSupport(address)" $TOKEN_ADDRESS \
  --private-key $PRIVATE_KEY --rpc-url $RPC_URL
```

## Important Notes

### EVM Compatibility

⚠️ **U2U Mainnet does not support Shanghai upgrade (PUSH0 opcode)**

The contract is compiled with `evmVersion: "paris"` for compatibility. This results in:
- Slightly higher gas costs (~1% increase)
- Larger bytecode (~100-200 bytes)
- **No functional differences**

U2U Testnet supports Shanghai, but we use Paris for consistency.

### Gas Optimization

The contract uses:
- Solidity 0.8.30 with IR-based compilation
- Optimizer runs: 200 (balanced for deployment and execution)
- Paris EVM target for maximum compatibility

## Development

### Running Tests

```bash
npx hardhat test
```

### Compile Contracts

```bash
npx hardhat compile
```

### Clean Build Artifacts

```bash
npx hardhat clean
```

## Contract Interface

### Core Functions

- `deposit(address token, uint256 amount, bytes calldata tail)` - Deposit funds
- `completePayment(...)` - Complete a payment with OTP verification
- `withdrawFunds(address token, uint256 amount)` - Withdraw user balance
- `merchantPrecommit(...)` - Create payment commitment
- `refreshTail(bytes calldata newTail)` - Update OTP tail

### Admin Functions

- `addCoinSupport(address token)` - Add ERC20 token support
- `setPaymaster(address newPaymaster)` - Update paymaster address
- `updateFeeRate(uint64 newFeeRate)` - Update fee rate (basis points)
- `withdrawFee(address token, address payable to, uint256 amount)` - Withdraw collected fees

### View Functions

- `getBalance(address user, address token)` - Get user balance
- `getUserTail(address user)` - Get user's current tail
- `getUserLimits(address user)` - Get user's payment limits
- `isCoinSupported(address token)` - Check token support
- `getSystemStats(address token)` - Get system statistics

## Security Considerations

1. **OTP Management**: Keep OTPs secure and never reuse them
2. **Tail Updates**: Monitor tail update limits to prevent lockout
3. **Payment Limits**: Set appropriate limits for your use case
4. **Token Approvals**: Always verify token addresses before approval

## License

MIT

## Support

For issues and questions:
- Open an issue on GitHub
- Contact the development team
- Check U2U Network documentation: https://docs.u2u.xyz
