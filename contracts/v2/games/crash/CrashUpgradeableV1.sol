// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { EIP712Upgradeable } from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

import { BPS } from "../../lib/BPS.sol";

import { NineSeven25x } from "./loot/NineSeven25x.sol";
import { GameUpgradeableV1 } from "../base/GameUpgradeableV1.sol";

contract CrashUpgradeableV1 is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    EIP712Upgradeable,
    GameUpgradeableV1,
    NineSeven25x
{
    bytes32 private constant _CASHOUT_HASH =
        keccak256(
            "Cashout(address sender,uint64 hashIndex,uint8 localIndex,uint8 globalIndex,uint8 currentCashout,uint8 newCashout,uint48 deadline)"
        );

    uint256 private constant _CANCEL_RETURN_NUMERATOR = 9700;
    uint256 private constant _CANCEL_FEE_NUMERATOR = 300;
    uint64 private constant _INTRO_BLOCKS = 20;
    uint256 private constant _MAX_BETS = 255;

    // #######################################################################################

    error AlreadyCashedOut();

    error BetNotFound();
    error BetNotYours();
    error BetIsCancelled();
    error BetExpired();

    error RoundIsFull();
    error RoundInProgress();
    error RoundNotStarted();
    error RoundNotRefundable();

    error InvalidSignature();
    error ExpiredSignature();
    error NotAllBetsProcessed();
    error InsufficientLiquidity();

    error InvalidValue(uint256 value);
    error InvalidBytes(bytes32 value);

    // #######################################################################################

    event RoundStarted(bytes32 indexed roundHash, uint64 hashIndex, uint64 startBlock);
    event RoundEnded(bytes32 indexed roundHash, bytes32 roundSalt, uint64 deadIndex, bytes32 proof);

    event RoundRefunded(bytes32 indexed roundHash);

    event BetPlaced(bytes32 indexed roundHash, Bet bet);
    event BetCashoutUpdated(bytes32 indexed roundHash, address token, uint8 index, uint8 cashoutIndex);
    event BetCancelled(bytes32 indexed roundHash, address token, uint8 index);

    // #######################################################################################

    struct Signature {
        bytes32 r;
        bytes32 s;
        uint8 v;
        uint48 deadline;
    }

    struct BetPool {
        uint256 requestId;
        uint248 liquidity;
        uint8 count;
        mapping(uint8 => Bet) bets;
    }

    struct Bet {
        uint256 amount;
        address user;
        uint8 cashoutIndex;
        uint8 globalIndex;
        uint8 localIndex;
        uint8 uiChannel;
        bool cancelled;
    }

    struct BetPoolOutput {
        uint256 liquidity;
        address token;
        Bet[] bets;
    }

    // #######################################################################################

    mapping(address => BetPool) private _betPools;

    bytes32 private _roundHash;
    uint64 private _hashIndex;
    uint64 private _roundStartBlock;
    uint8 private _totalBets;

    // #######################################################################################

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        address platform_,
        address treasury_,
        address randomness_
    ) GameUpgradeableV1(platform_, treasury_, randomness_) {
        _disableInitializers();
    }

    function initialize(bytes32 genesisHash_, address owner_) public initializer {
        __Ownable_init(owner_);
        __EIP712_init("Crash", "1");

        if (genesisHash_ == bytes32(0)) revert InvalidBytes(genesisHash_);
        _roundHash = genesisHash_;
    }

    // #######################################################################################

    /// @notice Returns the current hash index.
    function getHashIndex() external view returns (uint64) {
        return _hashIndex;
    }

    /// @notice Returns the current round start block.
    function getRoundStartBlock() external view returns (uint64) {
        return _roundStartBlock;
    }

    /// @notice Returns the current round hash.
    function getRoundHash() external view returns (bytes32) {
        return _roundHash;
    }

    function getBetPools(address[] calldata tokens_) external view returns (BetPoolOutput[] memory) {
        return _getBetPools(tokens_);
    }

    function getBlockHashes() external view returns (bytes32[] memory) {
        return _getBlockHashes(_roundStartBlock);
    }

    function getRoundInfo(
        address[] calldata tokens_
    )
        external
        view
        returns (
            uint64 startBlock_,
            uint64 hashIndex_,
            bytes32 roundHash_,
            BetPoolOutput[] memory betPools_,
            bytes32[] memory blockHashes_
        )
    {
        startBlock_ = _roundStartBlock;
        hashIndex_ = _hashIndex;
        roundHash_ = _roundHash;
        betPools_ = _getBetPools(tokens_);
        blockHashes_ = _getBlockHashes(startBlock_);
    }

    // #######################################################################################

    function updateBet(address token_, uint8 index_, uint8 cashout_) external {
        BetPool storage pool = _betPools[token_];
        Bet storage bet = _getBet(pool, index_);

        // Ensure the update is valid
        if (_roundStartBlock <= block.number) revert RoundInProgress();
        if (_getLength() <= cashout_) revert InvalidValue(cashout_);

        // Update the round liquidity
        uint256 amount = bet.amount;
        uint256 profit = _profit(amount, cashout_);

        uint256 available = pool.liquidity;

        unchecked {
            available += _profit(amount, bet.cashoutIndex);
        }

        if (available < profit) revert InsufficientLiquidity();

        unchecked {
            available -= profit;
        }

        pool.liquidity = uint248(available);

        // Update the bet
        bet.cashoutIndex = cashout_;

        // Emit an event for the bet updated
        emit BetCashoutUpdated(_roundHash, token_, index_, cashout_);
    }

    function cancelBet(address token_, uint8 index_) external {
        BetPool storage pool = _betPools[token_];
        Bet storage bet = _getBet(pool, index_);

        // Ensure the game has not started
        if (_roundStartBlock <= block.number) revert RoundInProgress();

        // Cancel the bet
        bet.cancelled = true;

        uint256 amount = bet.amount;

        // Partially refund the user
        _sendValue(token_, bet.user, BPS.calculate(amount, _CANCEL_RETURN_NUMERATOR));

        // Update the round liquidity
        uint248 profit = uint248(_profit(amount, bet.cashoutIndex));

        unchecked {
            pool.liquidity += profit;
        }

        // Emit an event for the bet cancelled
        emit BetCancelled(_roundHash, token_, index_);
    }

    function cashout(address token_, uint8 index_) external {
        BetPool storage pool = _betPools[token_];
        Bet storage bet = _getBet(pool, index_);

        // Ensure the game has started
        uint64 _bn = uint64(block.number);
        if (_bn < _roundStartBlock) revert RoundNotStarted();

        // Ensure the user has not cashed out already
        uint8 currentIndex = uint8(_bn - _roundStartBlock);
        if (bet.cashoutIndex <= currentIndex) revert AlreadyCashedOut();

        bet.cashoutIndex = currentIndex;

        emit BetCashoutUpdated(_roundHash, token_, index_, currentIndex);
    }

    function cashoutSigned(Signature calldata signature_, address token_, uint8 index_, uint8 cashout_) external {
        BetPool storage pool = _betPools[token_];
        Bet storage bet = _getBet(pool, index_);

        // Ensure the game has started
        if (uint64(block.number) < _roundStartBlock) revert RoundNotStarted();

        // Ensure the user has not cashed out already
        uint8 currentCashout = bet.cashoutIndex;
        if (currentCashout <= cashout_) revert AlreadyCashedOut();

        // Verify the signature
        if (_recoverSigner(signature_, bet.localIndex, bet.globalIndex, currentCashout, cashout_) != RANDOMNESS)
            revert InvalidSignature();

        bet.cashoutIndex = cashout_;

        emit BetCashoutUpdated(_roundHash, token_, index_, cashout_);
    }

    function reveal(address[] calldata tokens_, bytes32 _salt, bytes32 _nextHash) external onlyRandomness {
        if (_nextHash == bytes32(0)) revert InvalidBytes(_nextHash);
        if (keccak256(abi.encodePacked(_salt)) != _roundHash) revert InvalidBytes(_salt);

        (uint64 deadIndex, bytes32 proof) = _getDeadIndex(_salt, _roundStartBlock);

        uint8 totalBets = _totalBets;
        _totalBets = 0;

        for (uint256 ti = 0; ti < tokens_.length; ) {
            address token = tokens_[ti];
            BetPool storage pool = _betPools[token];

            uint256 incoming = 0;
            uint256 outgoing = 0;

            uint8 localBets = pool.count;
            pool.count = 0;

            for (uint8 tb = 0; tb < localBets; ) {
                Bet storage bet = pool.bets[tb];
                uint256 amount = bet.amount;

                if (bet.cancelled) {
                    uint256 fee = BPS.calculate(amount, _CANCEL_FEE_NUMERATOR);
                    unchecked {
                        incoming += fee;
                    }
                } else {
                    unchecked {
                        incoming += amount;
                    }

                    uint8 cashoutIndex = bet.cashoutIndex;
                    if (cashoutIndex < deadIndex) {
                        uint256 win = _multiply(amount, cashoutIndex);
                        _sendValue(token, bet.user, win);
                        unchecked {
                            outgoing += win;
                        }
                    }
                }

                unchecked {
                    ++tb;
                }
            }

            _settleLiquidityRequest(pool.requestId, token, incoming, outgoing);

            pool.requestId = 0;
            pool.liquidity = 0;

            unchecked {
                totalBets -= localBets;
                ++ti;
            }
        }

        if (totalBets != 0) revert NotAllBetsProcessed();

        emit RoundEnded(_roundHash, _salt, deadIndex, proof);

        _roundStartBlock = 0;
        _roundHash = _nextHash;
        unchecked {
            _hashIndex++;
        }
    }

    function emergencyRefund(address[] calldata tokens_) external {
        if (_roundStartBlock == 0 || block.number <= _roundStartBlock || blockhash(_roundStartBlock) != bytes32(0))
            revert RoundNotRefundable();

        uint8 totalBets = _totalBets;
        _totalBets = 0;

        for (uint256 ti = 0; ti < tokens_.length; ) {
            address token = tokens_[ti];
            BetPool storage pool = _betPools[token];

            uint256 incoming = 0;

            uint8 localBets = pool.count;
            pool.count = 0;

            for (uint8 tb = 0; tb < localBets; ) {
                Bet storage bet = pool.bets[tb];
                uint256 amount = bet.amount;

                if (bet.cancelled) {
                    uint256 fee = BPS.calculate(amount, _CANCEL_FEE_NUMERATOR);
                    unchecked {
                        incoming += fee;
                    }
                } else {
                    _sendValue(token, bet.user, amount);
                }

                unchecked {
                    ++tb;
                }
            }

            _settleLiquidityRequest(pool.requestId, token, incoming, 0);

            pool.requestId = 0;
            pool.liquidity = 0;

            unchecked {
                totalBets -= localBets;
                ++ti;
            }
        }

        if (totalBets != 0) revert NotAllBetsProcessed();

        _roundStartBlock = 0;

        emit RoundRefunded(_roundHash);
    }

    // #######################################################################################

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function _processBet(address placedBy_, address token_, uint256 amount_, bytes calldata data_) internal override {
        (uint8 cashoutIndex, uint8 betChannel, uint64 hashIndex) = abi.decode(data_, (uint8, uint8, uint64));

        // Ensure bet is valid
        if (_guaranteeStarted() <= block.number) revert RoundInProgress();
        if (_getLength() <= cashoutIndex) revert InvalidValue(cashoutIndex);
        if (hashIndex != _hashIndex) revert BetExpired();

        // Reduce the round liquidity by the users max win
        uint256 liquidity = _remainingLiquidity(token_);
        uint256 profit = _profit(amount_, cashoutIndex);

        if (liquidity < profit) revert InsufficientLiquidity();

        // Update pool
        BetPool storage betPool = _betPools[token_];

        uint8 localBets = betPool.count;
        uint8 totalBets = _totalBets;
        if (totalBets == _MAX_BETS) revert RoundIsFull();
        unchecked {
            _totalBets = totalBets + 1;
            betPool.count = localBets + 1;
            betPool.liquidity = uint248(liquidity - profit);
        }

        // Store the bet
        Bet memory bet = Bet(amount_, placedBy_, cashoutIndex, totalBets, localBets, betChannel, false);
        betPool.bets[localBets] = bet;

        emit BetPlaced(_roundHash, bet);
    }

    // ########################################################################################

    function _guaranteeStarted() private returns (uint64) {
        uint64 startBlock = _roundStartBlock;

        if (startBlock == 0) {
            startBlock = uint64(block.number) + _INTRO_BLOCKS;

            _roundStartBlock = startBlock;
            emit RoundStarted(_roundHash, _hashIndex, startBlock);
        }

        return startBlock;
    }

    function _remainingLiquidity(address token_) private returns (uint256) {
        BetPool storage pool = _betPools[token_];

        if (pool.requestId != 0) {
            (uint256 requestId, uint256 amount) = _requestLiquidity(token_, 0);
            pool.requestId = requestId;
            pool.liquidity = uint248(amount);

            return amount;
        }

        return pool.liquidity;
    }

    function _getBet(BetPool storage betPool_, uint8 index_) private view returns (Bet storage bet_) {
        if (betPool_.count <= index_) revert BetNotFound();

        bet_ = betPool_.bets[index_];

        if (bet_.user != msg.sender) revert BetNotYours();
        if (bet_.cancelled) revert BetIsCancelled();
    }

    function _recoverSigner(
        Signature calldata signature_,
        uint8 localIndex_,
        uint8 globalIndex_,
        uint8 current_,
        uint8 future_
    ) private view returns (address) {
        if (block.timestamp > signature_.deadline) revert ExpiredSignature();
        return
            ECDSA.recover(
                _hashTypedDataV4(
                    keccak256(
                        abi.encode(
                            _CASHOUT_HASH,
                            msg.sender,
                            _hashIndex,
                            localIndex_,
                            globalIndex_,
                            current_,
                            future_,
                            signature_.deadline
                        )
                    )
                ),
                signature_.v,
                signature_.r,
                signature_.s
            );
    }

    function _getBetPools(address[] calldata tokens_) private view returns (BetPoolOutput[] memory pools_) {
        uint256 tokens = tokens_.length;

        pools_ = new BetPoolOutput[](tokens);

        for (uint256 ti = 0; ti < tokens; ) {
            address token = tokens_[ti];
            BetPool storage pool = _betPools[token];

            uint8 count = pool.count;
            Bet[] memory bets = new Bet[](count);

            for (uint8 bi = 0; bi < count; ) {
                bets[bi] = pool.bets[bi];
                unchecked {
                    bi++;
                }
            }

            pools_[ti] = BetPoolOutput(pool.liquidity, token, bets);

            unchecked {
                ti++;
            }
        }
    }

    function _getBlockHashes(uint64 startBlock) private view returns (bytes32[] memory blockHashes_) {
        if (startBlock == 0 || startBlock >= block.number) {
            blockHashes_ = new bytes32[](0);
        } else {
            uint64 lootTableLength = uint64(_getLength());
            uint64 length = uint64(block.number) - startBlock;

            if (length > lootTableLength) {
                length = lootTableLength;
            }

            blockHashes_ = new bytes32[](length);

            for (uint64 i = 0; i < length; ) {
                blockHashes_[i] = blockhash(startBlock + i);

                unchecked {
                    i++;
                }
            }
        }
    }
}
