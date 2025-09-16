// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Liquidity } from "./liquidity/Liquidity.sol";
import { ILootTable } from "./interfaces/ILootTable.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title HashCrash
/// @notice The base hashcrash implementation, without specifying the value type.
abstract contract HashCrash is Liquidity {
    uint256 private constant _MAX_BET_QUEUE_SIZE = 256;

    error NotActive();
    error NotHashProducer();
    error AlreadyCashedOut();

    error BetNotFound();
    error BetNotYours();
    error BetIsCancelled();

    error RoundIsFull();
    error RoundInProgress();
    error RoundNotStarted();
    error RoundNotRefundable();

    error InvalidBytes(bytes32 value);

    // #######################################################################################

    event RoundStarted(bytes32 indexed roundHash, uint64 startBlock, uint64 hashIndex, uint256 liquidity);
    event RoundEnded(bytes32 indexed roundHash, bytes32 roundSalt, uint64 deadIndex, bytes32 proof);

    event RoundRefunded(bytes32 indexed roundHash);
    event RoundAccelerated(bytes32 indexed roundHash, uint64 startBlock);

    event BetPlaced(
        bytes32 indexed roundHash,
        uint256 indexed index,
        address indexed user,
        uint256 amount,
        uint64 cashoutIndex
    );
    event BetCashoutUpdated(bytes32 indexed roundHash, uint256 indexed index, uint64 cashoutIndex);
    event BetCancelled(bytes32 indexed roundHash, uint256 indexed index);

    event ActiveUpdated(bool active);
    event LootTableUpdated(address lootTable);
    event IntroBlocksUpdated(uint64 introBlocks);
    event HashProducerUpdated(address hashProducer);
    event ReducedIntroBlocksUpdated(uint32 reducedIntroBlocks);
    event CancelReturnNumeratorUpdated(uint32 cancelReturnNumerator);

    // #######################################################################################

    struct Bet {
        uint256 amount;
        address user;
        uint64 cashoutIndex;
    }

    struct BetOutput {
        uint256 amount;
        address user;
        uint64 cashoutIndex;
        bool cancelled;
    }

    modifier onlyHashProducer() {
        if (msg.sender != _hashProducer) revert NotHashProducer();
        _;
    }

    // #######################################################################################

    mapping(uint256 => Bet) private _bets;
    uint256 private _betCancelledBitmap;
    uint256 private _betsLength;

    bytes32 private _roundHash;
    address private _hashProducer;
    uint64 private _roundStartBlock;
    uint32 private _cancelReturnNumerator;

    ILootTable private _lootTable;
    uint64 private _introBlocks;
    uint32 private _reducedIntroBlocks;

    address private _stagedLootTable;
    uint64 private _hashIndex;
    bool private _active;

    // #######################################################################################

    /// @notice Constructor initializes the contract with the given parameters.
    /// @param lootTable_ The loot table to use for the game.
    /// @param genesisHash_ The initial hash for the round.
    /// @param hashProducer_ The address that can produce the next round hash.
    /// @param maxExposureNumerator_ The numerator for the maximum exposure, must be between 100 and 5000 (1% to 50%).
    /// @param lowLiquidityThreshold_ The round liquidity below which we should start the round early.
    /// @param owner_ The owner of the contract.
    constructor(
        address lootTable_,
        bytes32 genesisHash_,
        address hashProducer_,
        uint64 maxExposureNumerator_,
        uint256 lowLiquidityThreshold_,
        address owner_
    ) Liquidity(maxExposureNumerator_, lowLiquidityThreshold_) Ownable(owner_) {
        if (genesisHash_ == bytes32(0)) revert InvalidBytes(genesisHash_);
        _roundHash = genesisHash_;

        if (lootTable_ == address(0)) revert InvalidAddress(lootTable_);
        _setLootTable(lootTable_);

        _setHashProducer(hashProducer_);

        _setIntroBlocks(20);
        _setReducedIntroBlocks(5);
        _setCancelReturnNumerator(9700);
    }

    // ########################################################################################

    /// @notice Returns the current active state of the game.
    function getActive() external view returns (bool) {
        return _active;
    }

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

    /// @notice Returns the current hash producer address.
    function getHashProducer() external view returns (address) {
        return _hashProducer;
    }

    /// @notice Returns the current cancel return numerator.
    function getCancelReturnNumerator() external view returns (uint32) {
        return _cancelReturnNumerator;
    }

    /// @notice Returns the current loot table address.
    function getLootTable() external view returns (address) {
        return address(_lootTable);
    }

    /// @notice Returns the staged loot table address.
    function getStagedLootTable() external view returns (address) {
        return _stagedLootTable;
    }

    /// @notice Returns the number of intro blocks before the round starts.
    function getIntroBlocks() external view returns (uint64) {
        return _introBlocks;
    }

    /// @notice Returns the reduced number of intro blocks once low liquidity is hit.
    function getReducedIntroBlocks() external view returns (uint32) {
        return _reducedIntroBlocks;
    }

    /// @notice Returns the number of bets placed in the current round.
    function getBetsLength() external view returns (uint256) {
        return _betsLength;
    }

    /// @notice Gets the bet at the specified index.
    function getBet(uint256 _index) external view returns (BetOutput memory) {
        if (_index >= _betsLength) revert BetNotFound();

        uint256 bitmap = _betCancelledBitmap;
        Bet storage bet = _bets[_index];

        return
            BetOutput({
                amount: bet.amount,
                user: bet.user,
                cashoutIndex: bet.cashoutIndex,
                cancelled: _getCancelled(_index, bitmap)
            });
    }

    /// @notice Returns the bets placed in the current round.
    function getBets() external view returns (BetOutput[] memory) {
        return _getBets();
    }

    /// @notice Returns all bets placed in the current round by the given user.
    function getBetsFor(address _user) external view returns (BetOutput[] memory) {
        uint256 length = _betsLength;
        uint256 count = 0;

        for (uint256 i = 0; i < length; ) {
            if (_bets[i].user == _user) {
                count++;
            }

            unchecked {
                i++;
            }
        }

        BetOutput[] memory userBets = new BetOutput[](count);
        uint256 bitmap = _betCancelledBitmap;

        count = 0;
        for (uint256 i = 0; i < length; ) {
            Bet memory b = _bets[i];
            if (b.user == _user) {
                userBets[count] = BetOutput({
                    amount: b.amount,
                    user: b.user,
                    cashoutIndex: b.cashoutIndex,
                    cancelled: _getCancelled(i, bitmap)
                });

                unchecked {
                    count++;
                }
            }

            unchecked {
                i++;
            }
        }

        return userBets;
    }

    /// @notice Returns the current round block hashes.
    function getBlockHashes() external view returns (bytes32[] memory) {
        return _getBlockHashes(_roundStartBlock);
    }

    /// @notice Returns the current round information.
    /// @return active_ Whether the game is currently active.
    /// @return hashIndex_ The index of the current round hash.
    /// @return startBlock_ The block number when the current round started.
    /// @return lootTable_ The loot table used for the current round.
    /// @return minimum_ The minimum value to either bet or manage liquidity.
    /// @return roundLiquidity_ The total liquidity available for the current round.
    /// @return hash_ The current round hash.
    /// @return bets_ An array of all bets placed in the current round.
    /// @return blockHashes_ An array of block hashes from the start of the round to the current block (exclusive).
    function getRoundInfo()
        external
        view
        returns (
            bool active_,
            uint64 hashIndex_,
            uint64 startBlock_,
            ILootTable lootTable_,
            uint256 minimum_,
            uint256 roundLiquidity_,
            bytes32 hash_,
            BetOutput[] memory bets_,
            bytes32[] memory blockHashes_
        )
    {
        active_ = _active;
        hashIndex_ = _hashIndex;
        startBlock_ = _roundStartBlock;
        lootTable_ = _lootTable;
        minimum_ = _getMinimum();
        roundLiquidity_ = _getAvailableLiquidity();
        hash_ = _roundHash;
        bets_ = _getBets();
        blockHashes_ = _getBlockHashes(startBlock_);
    }

    // ########################################################################################

    /// @notice Sets the active state of the game.
    /// @param active_ The new active state.
    /// @dev If the game is set to inactive, it will not allow the start of a new round.
    function setActive(bool active_) external onlyOwner {
        _setActive(active_);
    }

    /// @notice Sets the cancel return numerator.
    /// @param cancelReturnNumerator_ The new cancel return numerator.
    /// @dev The numerator must be less than or equal to the denominator (10000).
    function setCancelReturnNumerator(uint32 cancelReturnNumerator_) external onlyOwner {
        _setCancelReturnNumerator(cancelReturnNumerator_);
    }

    /// @notice Sets the hash producer address.
    /// @param hashProducer_ The new hash producer address.
    function setHashProducer(address hashProducer_) external onlyOwner {
        _setHashProducer(hashProducer_);
    }

    /// @notice Sets the number of intro blocks before the round starts.
    /// @param introBlocks_ The number of intro blocks.
    function setIntroBlocks(uint64 introBlocks_) external onlyOwner {
        _setIntroBlocks(introBlocks_);
    }

    /// @notice Sets the maximum number of intro blocks once low liquidity is hit.
    /// @param reducedIntroBlocks_ The reduced number of intro blocks.
    function setReducedIntroBlocks(uint32 reducedIntroBlocks_) external onlyOwner {
        _setReducedIntroBlocks(reducedIntroBlocks_);
    }

    /// @notice Sets the loot table for the game.
    /// @param lootTable_ The new loot table to use.
    /// @dev If the game is currently idle, the loot table is set immediately. Otherwise, it is staged for the next round.
    function setLootTable(address lootTable_) external onlyOwner {
        if (lootTable_ == address(0)) revert InvalidAddress(lootTable_);

        if (_isIdle()) {
            _setLootTable(lootTable_);
        } else {
            _stagedLootTable = lootTable_;
        }
    }

    // ########################################################################################

    /// @notice Places a bet in the current round.
    /// @param _amount The token amount to bet.
    /// @param _autoCashout The index of the auto cashout in the loot table.
    /// @dev If the round has not started, it will initialise the round.
    function placeBet(uint256 _amount, uint64 _autoCashout) external payable {
        if (_roundStartBlock == 0) {
            _initialiseRound();
        }

        uint256 length = _betsLength;

        // Ensure the bet is valid
        if (length == _MAX_BET_QUEUE_SIZE) revert RoundIsFull();
        if (_roundStartBlock <= block.number) revert RoundInProgress();
        if (_lootTable.getLength() <= _autoCashout) revert InvalidValue(_autoCashout);

        // Wrap any native ether, standardize behavior between weth and other erc20's.
        _amount = _receiveValue(msg.sender, _amount);

        // Ensure the amount is at least the minimum required.
        _ensureMinimum(_amount);

        // Reduce the round liquidity by the users max win
        _useRoundLiquidity(_lootTable.multiply(_amount, _autoCashout));

        // Emit an event for the bet placed
        emit BetPlaced(_roundHash, length, msg.sender, _amount, _autoCashout);

        // Store the bet
        _bets[length] = Bet(_amount, msg.sender, _autoCashout);
        unchecked {
            _betsLength = length + 1;
        }
    }

    /// @notice Updates the auto cashout index for a bet.
    /// @param _index The index of the bet to update.
    /// @param _autoCashout The new auto cashout index in the loot table.
    function updateBet(uint256 _index, uint64 _autoCashout) external {
        Bet storage bet = _getBet(_index, _betCancelledBitmap);

        // Ensure the update is valid
        if (_roundStartBlock <= block.number) revert RoundInProgress();
        if (_lootTable.getLength() <= _autoCashout) revert InvalidValue(_autoCashout);

        // Update the round liquidity
        uint256 amount = bet.amount;
        _releaseRoundLiquidity(_lootTable.multiply(amount, bet.cashoutIndex));
        _useRoundLiquidity(_lootTable.multiply(amount, _autoCashout));

        // Update the bet
        bet.cashoutIndex = _autoCashout;

        // Emit an event for the bet updated
        emit BetCashoutUpdated(_roundHash, _index, _autoCashout);
    }

    /// @notice Cancels a bet and refunds the user.
    /// @param _index The index of the bet to cancel.
    function cancelBet(uint256 _index) external {
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

    /// @notice Allows a user to cash out their bet at the current block index.
    /// @param _index The index of the bet to cash out.
    function cashout(uint256 _index) external {
        Bet storage bet = _getBet(_index, _betCancelledBitmap);

        // Ensure the game has started
        uint64 _bn = uint64(block.number);
        if (_bn < _roundStartBlock) revert RoundNotStarted();

        // Ensure the user has not cashed out already
        uint64 blockIndex = _bn - _roundStartBlock;
        if (bet.cashoutIndex <= blockIndex) revert AlreadyCashedOut();

        bet.cashoutIndex = blockIndex;

        emit BetCashoutUpdated(_roundHash, _index, blockIndex);
    }

    /// @notice Reveals the round result and processes the bets.
    /// @param _salt The salt used to generate the round hash.
    /// @param _nextHash The hash for the next round.
    function reveal(bytes32 _salt, bytes32 _nextHash) external onlyHashProducer {
        if (_nextHash == bytes32(0)) revert InvalidBytes(_nextHash);
        if (keccak256(abi.encodePacked(_salt)) != _roundHash) revert InvalidBytes(_salt);

        (uint64 deadIndex, bytes32 proof) = _lootTable.getDeathProof(_salt, _roundStartBlock);

        _processBets(deadIndex);
        _clearLiquidityQueue();

        emit RoundEnded(_roundHash, _salt, deadIndex, proof);

        _roundStartBlock = 0;
        _roundHash = _nextHash;
        unchecked {
            _hashIndex++;
        }
    }

    /// @notice Refunds the round.
    /// @dev This can only be called in an emergency situation, where the reveal has been delayed and it is no longer possible for the chain to access the round blockhashes.
    /// @dev After this function is called, the contract is disabled and no further bets can be placed until the issue is resolved.
    function emergencyRefund() external {
        if (_roundStartBlock == 0 || block.number <= _roundStartBlock || blockhash(_roundStartBlock) != bytes32(0))
            revert RoundNotRefundable();

        _roundStartBlock = 0;
        _setActive(false);

        _refundBets();
        _clearLiquidityQueue();

        emit RoundRefunded(_roundHash);
    }

    // ########################################################################################

    function _canChangeLiquidity() internal view override returns (bool) {
        return _isIdle();
    }

    function _onLowLiquidity() internal override {
        if (_roundStartBlock != 0 && block.number < _roundStartBlock - _reducedIntroBlocks) {
            _roundStartBlock = uint64(block.number + _reducedIntroBlocks);
            emit RoundAccelerated(_roundHash, _roundStartBlock);
        }
    }

    // ########################################################################################

    function _getBets() private view returns (BetOutput[] memory bets_) {
        bets_ = new BetOutput[](_betsLength);

        uint256 bitmap = _betCancelledBitmap;
        for (uint256 i = 0; i < bets_.length; ) {
            Bet memory b = _bets[i];
            bets_[i] = BetOutput({
                amount: b.amount,
                user: b.user,
                cashoutIndex: b.cashoutIndex,
                cancelled: _getCancelled(i, bitmap)
            });

            unchecked {
                i++;
            }
        }
    }

    function _getBlockHashes(uint64 startBlock) private view returns (bytes32[] memory blockHashes_) {
        if (_isIdle() || startBlock >= block.number) {
            blockHashes_ = new bytes32[](0);
        } else {
            uint64 lootTableLength = uint64(_lootTable.getLength());
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

    function _isIdle() private view returns (bool) {
        return _roundStartBlock == 0;
    }

    function _getBet(uint256 _index, uint256 _bitmap) private view returns (Bet storage bet_) {
        if (_index >= _betsLength) revert BetNotFound();

        bet_ = _bets[_index];

        if (bet_.user != msg.sender) revert BetNotYours();
        if (_getCancelled(_index, _bitmap)) revert BetIsCancelled();
    }

    function _getCancelReturn(uint256 _amount) private view returns (uint256) {
        return (_amount * _cancelReturnNumerator) / _DENOMINATOR;
    }

    function _getCancelled(uint256 _index, uint256 _bitmap) private pure returns (bool) {
        return (_bitmap & (1 << _index)) != 0;
    }

    function _setCancelled(uint256 _index, uint256 _bitmap) private pure returns (uint256) {
        return _bitmap |= (1 << _index);
    }

    function _initialiseRound() private {
        if (!_active) revert NotActive();

        // Apply the staged loot table if it exists
        address staged = _stagedLootTable;
        if (staged != address(0)) {
            _setLootTable(staged);
            delete _stagedLootTable;
        }

        _roundStartBlock = uint64(block.number) + _introBlocks;
        emit RoundStarted(_roundHash, _roundStartBlock, _hashIndex, _getAvailableLiquidity());
    }

    function _setActive(bool active_) private {
        if (_active == active_) return;
        _active = active_;
        emit ActiveUpdated(active_);
    }

    function _setLootTable(address lootTable_) private {
        _lootTable = ILootTable(lootTable_);
        emit LootTableUpdated(lootTable_);
    }

    function _setHashProducer(address hashProducer_) private {
        if (hashProducer_ == address(0)) revert InvalidAddress(hashProducer_);
        _hashProducer = hashProducer_;
        emit HashProducerUpdated(hashProducer_);
    }

    function _setIntroBlocks(uint64 introBlocks_) private {
        if (introBlocks_ == 0 || introBlocks_ < _reducedIntroBlocks) revert InvalidValue(introBlocks_);
        _introBlocks = introBlocks_;
        emit IntroBlocksUpdated(introBlocks_);
    }

    function _setReducedIntroBlocks(uint32 reducedIntroBlocks_) private {
        if (reducedIntroBlocks_ == 0 || reducedIntroBlocks_ > _introBlocks) revert InvalidValue(reducedIntroBlocks_);
        _reducedIntroBlocks = reducedIntroBlocks_;
        emit ReducedIntroBlocksUpdated(reducedIntroBlocks_);
    }

    function _setCancelReturnNumerator(uint32 cancelReturnNumerator_) private {
        if (cancelReturnNumerator_ > _DENOMINATOR) revert InvalidValue(cancelReturnNumerator_);
        _cancelReturnNumerator = cancelReturnNumerator_;
        emit CancelReturnNumeratorUpdated(cancelReturnNumerator_);
    }

    function _processBets(uint64 _deadIndex) private {
        uint256 bitmap = _betCancelledBitmap;
        _betCancelledBitmap = 0;

        uint256 length = _betsLength;
        _betsLength = 0;

        for (uint256 i = 0; i < length; ) {
            if (!_getCancelled(i, bitmap)) {
                Bet memory bet = _bets[i];

                if (bet.cashoutIndex < _deadIndex) {
                    _sendValue(bet.user, _lootTable.multiply(bet.amount, bet.cashoutIndex));
                }
            }

            unchecked {
                i++;
            }
        }
    }

    function _refundBets() private {
        uint256 bitmap = _betCancelledBitmap;
        _betCancelledBitmap = 0;

        uint256 length = _betsLength;
        _betsLength = 0;

        for (uint256 i = 0; i < length; ) {
            if (!_getCancelled(i, bitmap)) {
                _sendValue(_bets[i].user, _bets[i].amount);
                emit BetCancelled(_roundHash, i);
            }

            unchecked {
                i++;
            }
        }
    }
}
