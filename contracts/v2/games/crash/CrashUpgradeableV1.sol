// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { NineSeven25x } from "./loot/NineSeven25x.sol";
import { GameUpgradeableV1 } from "../base/GameUpgradeableV1.sol";

contract CrashUpgradeableV1 is Initializable, UUPSUpgradeable, OwnableUpgradeable, GameUpgradeableV1, NineSeven25x {
    uint256 private constant _CANCEL_RETURN_NUMERATOR = 9700;
    uint64 private constant _INTRO_BLOCKS = 20;
    uint256 private constant _MAX_BETS = 248;

    // #######################################################################################

    error AlreadyCashedOut();

    error BetNotFound();
    error BetNotYours();
    error BetIsCancelled();

    error RoundIsFull();
    error RoundInProgress();
    error RoundNotStarted();
    error RoundNotRefundable();

    error InsufficientLiquidity();

    error InvalidValue(uint256 value);
    error InvalidBytes(bytes32 value);

    // #######################################################################################

    event RoundStarted(bytes32 indexed roundHash, uint64 hashIndex, uint64 startBlock);

    event BetPlaced(bytes32 indexed roundHash, Bet bet);

    // #######################################################################################

    struct LiquidityPool {
        uint256 requestId;
        uint256 remaining;
    }

    struct BetPool {
        uint8 count;
        uint248 cancelledBitmap;
        mapping(uint8 => Bet) bets;
    }

    struct Bet {
        uint256 amount;
        address user;
        uint8 cashoutIndex;
        uint8 globalIndex;
        uint8 localIndex;
        uint8 uiChannel;
    }

    // #######################################################################################

    mapping(address => LiquidityPool) private _liquidityPools;
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

        if (genesisHash_ == bytes32(0)) revert InvalidBytes(genesisHash_);
        _roundHash = genesisHash_;
    }

    // #######################################################################################

    function updateBet(address token_, uint8 index_, uint8 cashout_) external {
        Bet storage bet = _getBet(token_, index_, _betPools[token_].cancelledBitmap);

        // Ensure the update is valid
        if (_roundStartBlock <= block.number) revert RoundInProgress();
        if (_getLength() <= cashout_) revert InvalidValue(cashout_);

        // Update the round liquidity
        uint256 amount = bet.amount;
        uint256 profit = _profit(amount, cashout_);

        LiquidityPool storage pool = _liquidityPools[token_];
        uint256 available = pool.remaining;

        unchecked {
            available += _profit(amount, bet.cashoutIndex);
        }

        if (available < profit) revert InsufficientLiquidity();

        unchecked {
            available -= profit;
        }

        pool.remaining = available;

        // Update the bet
        bet.cashoutIndex = cashout_;

        // Emit an event for the bet updated
        emit BetCashoutUpdated(_roundHash, index_, cashout_);
    }

    function cancelBet(address token_, uint8 index_) external {
        uint256 _bitmap = _betCancelledBitmap;
        Bet storage bet = _getBet(_index, _bitmap);

        // Ensure the game has not started
        if (_roundStartBlock <= block.number) revert RoundInProgress();

        // Cancel the bet
        _betCancelledBitmap = _setCancelled(_index, _bitmap);

        // Partially refund the user
        _sendValue(msg.sender, _getCancelReturn(bet.amount));

        // Update the round liquidity
        _releaseRoundLiquidity(_lootTable.multiply(bet.amount, bet.cashoutIndex));

        // Emit an event for the bet cancelled
        emit BetCancelled(_roundHash, _index);
    }

    // #######################################################################################

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function _processBet(address placedBy_, address token_, uint256 amount_, bytes calldata data_) internal override {
        (uint8 cashoutIndex, uint8 betChannel) = abi.decode(data_, (uint8, uint8));

        // Ensure bet is valid
        if (_guaranteeStarted() <= block.number) revert RoundInProgress();
        if (_getLength() <= cashoutIndex) revert InvalidValue(cashoutIndex);

        // Reduce the round liquidity by the users max win
        uint256 liquidity = _remainingLiquidity(token_);
        uint256 profit = _profit(amount_, cashoutIndex);

        if (liquidity < profit) revert InsufficientLiquidity();

        unchecked {
            _liquidityPools[token_].remaining = liquidity - profit;
        }

        // Handle counters
        BetPool storage betPool = _betPools[token_];

        uint8 localBets = betPool.count;
        uint8 totalBets = _totalBets;
        if (totalBets == _MAX_BETS) revert RoundIsFull();
        unchecked {
            _totalBets = totalBets + 1;
            betPool.count = localBets + 1;
        }

        // Store the bet
        Bet memory bet = Bet(amount_, placedBy_, cashoutIndex, totalBets, localBets, betChannel);
        _betPools[token_].bets[localBets] = bet;

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
        LiquidityPool storage pool = _liquidityPools[token_];

        if (pool.requestId != 0) {
            (uint256 requestId, uint256 amount) = _requestLiquidity(token_, 0);
            pool.requestId = requestId;
            pool.remaining = amount;

            return amount;
        }

        return pool.remaining;
    }

    function _getBet(address token_, uint8 index_, uint248 bitmap_) private view returns (Bet storage bet_) {
        BetPool storage betPool = _betPools[token_];

        if (betPool.count <= index_) revert BetNotFound();

        bet_ = betPool.bets[index_];

        if (bet_.user != msg.sender) revert BetNotYours();
        if (_getCancelled(index_, bitmap_)) revert BetIsCancelled();
    }

    function _getCancelled(uint8 index_, uint248 bitmap_) private pure returns (bool) {
        return (bitmap_ & (1 << index_)) != 0;
    }

    function _setCancelled(uint8 index_, uint248 bitmap_) private pure returns (uint256) {
        return bitmap_ |= (1 << index_);
    }
}
