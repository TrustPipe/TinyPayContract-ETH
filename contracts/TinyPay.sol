// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract TinyPay {
    uint256 public totalDeposits;
    uint256 public totalWithdrawals;
    uint64  public feeRate;     // basis points (100 = 1%)
    address public admin;
    address public paymaster;
    bool    public initialized;

    struct UserAccount {
        uint256 balance;          // in wei
        bytes32 tail;             // current tail
        uint64  paymentLimit;     // 0 = unlimited
        uint64  tailUpdateCount;  // how many times tail changed
        uint64  maxTailUpdates;   // 0 = unlimited
    }

    struct PreCommit {
        address merchant;
        uint64  expiryTime;       // unix seconds
    }

    mapping(address => UserAccount) private accounts;
    mapping(bytes32 => PreCommit)  private precommits;

    event AccountInitialized(address indexed user);
    event DepositMade(address indexed user, uint256 amount, bytes32 tail, uint256 newBalance, uint64 timestamp);
    event PreCommitMade(address indexed merchant, bytes32 commitHash, uint64 expiryTime);
    event PaymentCompleted(address indexed payer, address indexed recipient, uint256 amount, uint256 fee, bytes32 newTail, uint64 timestamp);
    event PaymentLimitUpdated(address indexed user, uint64 oldLimit, uint64 newLimit, uint64 timestamp);
    event TailUpdatesLimitSet(address indexed user, uint64 oldLimit, uint64 newLimit, uint64 timestamp);
    event TailRefreshed(address indexed user, bytes32 oldTail, bytes32 newTail, uint64 tailUpdateCount, uint64 timestamp);
    event FundsAdded(address indexed user, uint256 amount, uint256 newBalance, uint64 timestamp);
    event FundsWithdrawn(address indexed user, uint256 amount, uint256 newBalance, uint64 timestamp);

    modifier onlyAdmin() {
        require(msg.sender == admin, "NOT_ADMIN");
        _;
    }

    modifier onlyInitialized() {
        require(initialized, "NOT_INIT");
        _;
    }

    receive() external payable {
        revert("DIRECT_ETH_DISABLED");
    }

    // Initialize once after deploy
    function initSystem(address _paymaster, uint64 _feeRate) external {
        require(!initialized, "ALREADY_INIT");
        admin = msg.sender;
        paymaster = _paymaster;
        feeRate = _feeRate;
        initialized = true;
    }

    // payable deposit; auto-inits account and optionally sets tail
    function deposit(bytes32 tail) public payable onlyInitialized {
        require(msg.value > 0, "INVALID_AMOUNT");

        UserAccount storage a = accounts[msg.sender];
        bool fresh = (a.balance == 0 && a.tail == bytes32(0) && a.paymentLimit == 0 && a.tailUpdateCount == 0 && a.maxTailUpdates == 0);
        if (fresh) {
            emit AccountInitialized(msg.sender);
        }

        if (tail != bytes32(0) && tail != a.tail) {
            a.tailUpdateCount += 1;
            a.tail = tail;
        }

        a.balance += msg.value;
        totalDeposits += msg.value;

        emit DepositMade(msg.sender, msg.value, a.tail, a.balance, uint64(block.timestamp));
    }

    // Add funds without touching tail
    function addFunds() external payable onlyInitialized {
        require(msg.value > 0, "INVALID_AMOUNT");
        UserAccount storage a = accounts[msg.sender];
        bool fresh = (a.balance == 0 && a.tail == bytes32(0) && a.paymentLimit == 0 && a.tailUpdateCount == 0 && a.maxTailUpdates == 0);
        if (fresh) {
            emit AccountInitialized(msg.sender);
        }
        a.balance += msg.value;
        totalDeposits += msg.value;
        emit FundsAdded(msg.sender, msg.value, a.balance, uint64(block.timestamp));
    }

    // Merchant pre-commit; expires in 15 minutes
    function merchantPrecommit(bytes32 commitHash) external onlyInitialized {
        require(commitHash != bytes32(0), "INVALID_COMMIT");
        require(precommits[commitHash].merchant == address(0), "COMMIT_EXISTS");

        uint64 expiry = uint64(block.timestamp + 15 minutes);
        precommits[commitHash] = PreCommit({ merchant: msg.sender, expiryTime: expiry });

        emit PreCommitMade(msg.sender, commitHash, expiry);
    }

    // Complete payment; paymaster can bypass commit checks
    // Check: sha256(opt) must equal payer.tail
    function completePayment(
        bytes32 opt,
        address payer,
        address payable recipient,
        uint256 amount,
        bytes32 commitHash
    ) external onlyInitialized {
        require(amount > 0, "INVALID_AMOUNT");
        UserAccount storage a = accounts[payer];
        require(a.balance >= amount, "INSUFFICIENT_BALANCE");

        bool isPaymaster = (msg.sender == paymaster);
        if (!isPaymaster) {
            bytes32 computed = sha256(abi.encode(payer, recipient, amount, opt));
            require(computed == commitHash, "INVALID_PRECOMMIT_HASH");
            PreCommit memory pc = precommits[commitHash];
            require(pc.merchant != address(0), "PRECOMMIT_NOT_FOUND");
            require(block.timestamp <= pc.expiryTime, "PRECOMMIT_EXPIRED");
            delete precommits[commitHash];
        }

        // Verify sha256(opt) matches current tail
        bytes32 optHash = sha256(abi.encodePacked(opt));
        require(optHash == a.tail, "INVALID_OPT");

        // Limits
        if (a.paymentLimit > 0) {
            require(amount <= a.paymentLimit, "PAYMENT_LIMIT");
        }
        if (a.maxTailUpdates > 0) {
            require(a.tailUpdateCount < a.maxTailUpdates, "TAIL_UPDATES_LIMIT");
        }

        // Effects
        uint256 fee = (amount * feeRate) / 10000;
        uint256 toRecipient = amount - fee;

        a.balance -= amount;
        a.tail = opt; // advance tail
        a.tailUpdateCount += 1;

        totalWithdrawals += amount;

        // Interaction
        (bool ok, ) = recipient.call{value: toRecipient}("");
        require(ok, "TRANSFER_FAIL");

        emit PaymentCompleted(payer, recipient, amount, fee, opt, uint64(block.timestamp));
    }

    // User config
    function setPaymentLimit(uint64 limit) external onlyInitialized {
        UserAccount storage a = accounts[msg.sender];
        uint64 old = a.paymentLimit;
        a.paymentLimit = limit;
        emit PaymentLimitUpdated(msg.sender, old, limit, uint64(block.timestamp));
    }

    function setTailUpdatesLimit(uint64 limit) external onlyInitialized {
        UserAccount storage a = accounts[msg.sender];
        uint64 old = a.maxTailUpdates;
        a.maxTailUpdates = limit;
        emit TailUpdatesLimitSet(msg.sender, old, limit, uint64(block.timestamp));
    }

    function refreshTail(bytes32 newTail) external onlyInitialized {
        UserAccount storage a = accounts[msg.sender];
        if (a.maxTailUpdates > 0) {
            require(a.tailUpdateCount < a.maxTailUpdates, "TAIL_UPDATES_LIMIT");
        }
        bytes32 oldTail = a.tail;
        if (newTail != oldTail) {
            a.tail = newTail;
            a.tailUpdateCount += 1;
        }
        emit TailRefreshed(msg.sender, oldTail, newTail, a.tailUpdateCount, uint64(block.timestamp));
    }

    // Withdraw user funds
    function withdrawFunds(uint256 amount) external onlyInitialized {
        require(amount > 0, "INVALID_AMOUNT");
        UserAccount storage a = accounts[msg.sender];
        require(a.balance >= amount, "INSUFFICIENT_BALANCE");

        a.balance -= amount;
        totalWithdrawals += amount;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "TRANSFER_FAIL");

        emit FundsWithdrawn(msg.sender, amount, a.balance, uint64(block.timestamp));
    }

    // Admin
    function updateFeeRate(uint64 newFeeRate) external onlyAdmin {
        feeRate = newFeeRate;
    }

    function setPaymaster(address newPaymaster) external onlyAdmin {
        paymaster = newPaymaster;
    }

    function withdrawFee(address payable to, uint256 amount) external onlyAdmin {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "FEE_WITHDRAW_FAIL");
    }

    // Views
    function getBalance(address user) external view returns (uint256) {
        return accounts[user].balance;
    }

    function getUserTail(address user) external view returns (bytes32) {
        return accounts[user].tail;
    }

    // (paymentLimit, tailUpdateCount, maxTailUpdates)
    function getUserLimits(address user) external view returns (uint64, uint64, uint64) {
        UserAccount memory a = accounts[user];
        return (a.paymentLimit, a.tailUpdateCount, a.maxTailUpdates);
    }

    // (totalDeposits, totalWithdrawals, feeRate)
    function getSystemStats() external view returns (uint256, uint256, uint64) {
        return (totalDeposits, totalWithdrawals, feeRate);
    }

    function isAccountInitialized(address user) external view returns (bool) {
        UserAccount memory a = accounts[user];
        return (a.balance > 0 || a.tail != bytes32(0) || a.paymentLimit > 0 || a.tailUpdateCount > 0 || a.maxTailUpdates > 0);
    }

    function getVaultAddress() external view returns (address) {
        return address(this);
    }
}
