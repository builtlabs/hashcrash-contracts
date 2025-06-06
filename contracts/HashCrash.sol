// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Liquidity } from "./liquidity/Liquidity.sol";
import { ILootTable } from "./interfaces/ILootTable.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title HashCrash
/// @notice The base hashcrash implementation, without specifying the value type.
abstract contract HashCrash is Liquidity {
    error NotActiveError();

    error BetNotFoundError();
    error BetNotYoursError();
    error BetCancelledError();

    error NotHashProducerError();

    error RoundInProgressError();
    error RoundNotStartedError();

    error InvalidHashError();
    error InvalidCashoutIndexError();

    // #######################################################################################

    event RoundStarted(bytes32 indexed roundHash, uint64 startBlock, uint64 hashIndex);
    event RoundEnded(bytes32 indexed roundHash, bytes32 roundSalt, uint64 deadIndex);

    event BetPlaced(bytes32 indexed roundHash, address indexed user, uint256 amount, uint64 cashoutIndex);
    event BetCashoutUpdated(bytes32 indexed roundHash, uint256 indexed index, uint64 cashoutIndex);
    event BetCancelled(bytes32 indexed roundHash, uint256 indexed index);

    event ActiveUpdated(bool active);
    event LootTableUpdated(ILootTable lootTable);

    // #######################################################################################

    struct Bet {
        uint256 amount;
        address user;
        uint64 cashoutIndex;
        bool cancelled;
    }

    modifier onlyHashProducer() {
        if (msg.sender != _hashProducer) revert NotHashProducerError();
        _;
    }

    // #######################################################################################

    Bet[] private _bets;

    bytes32 private _roundHash;
    address private _hashProducer;
    uint64 private _roundStartBlock;

    ILootTable private _lootTable;
    uint64 private _introBlocks;

    ILootTable private _stagedLootTable;
    uint64 private _hashIndex;
    bool private _active;

    // #######################################################################################

    /// @notice Constructor initializes the contract with the given parameters.
    /// @param lootTable_ The loot table to use for the game.
    /// @param genesisHash_ The initial hash for the round.
    /// @param hashProducer_ The address that can produce the next round hash.
    /// @param owner_ The owner of the contract.
    constructor(
        ILootTable lootTable_,
        bytes32 genesisHash_,
        address hashProducer_,
        address owner_
    ) Liquidity() Ownable(owner_) {
        _introBlocks = 20;
        _roundHash = genesisHash_;
        _hashProducer = hashProducer_;

        _setLootTable(lootTable_);
    }

    // ########################################################################################

    /// @notice Returns whether the game is active.
    function getActive() external view returns (bool) {
        return _active;
    }

    /// @notice Returns the current loot table.
    function getLootTable() external view returns (ILootTable) {
        return _lootTable;
    }

    /// @notice Returns the staged loot table, if any. It will be applied when the next round starts.
    function getStagedLootTable() external view returns (ILootTable) {
        return _stagedLootTable;
    }

    /// @notice Returns the current hash producer.
    function getHashProducer() external view returns (address) {
        return _hashProducer;
    }

    /// @notice Returns the number of blocks between the first bet and the start of the round.
    function getIntroBlocks() external view returns (uint64) {
        return _introBlocks;
    }

    /// @notice Returns all bets placed in the current round by the given user.
    function getBetsFor(address _user) external view returns (Bet[] memory) {
        uint256 count = 0;

        for (uint256 i = 0; i < _bets.length; i++) {
            if (_bets[i].user == _user) {
                count++;
            }
        }

        Bet[] memory userBets = new Bet[](count);

        count = 0;
        for (uint256 i = 0; i < _bets.length; i++) {
            if (_bets[i].user == _user) {
                userBets[count] = _bets[i];
                count++;
            }
        }

        return userBets;
    }

    /// @notice Returns the current round information.
    /// @return hashIndex_ The index of the current round hash.
    /// @return startBlock_ The block number when the current round started.
    /// @return roundLiquidity_ The total liquidity available for the current round.
    /// @return hash_ The current round hash.
    /// @return bets_ An array of all bets placed in the current round.
    /// @return blockHashes_ An array of block hashes from the start of the round to the current block (exclusive).
    function getRoundInfo()
        external
        view
        returns (
            uint64 hashIndex_,
            uint64 startBlock_,
            uint256 roundLiquidity_,
            bytes32 hash_,
            Bet[] memory bets_,
            bytes32[] memory blockHashes_
        )
    {
        hashIndex_ = _hashIndex;
        startBlock_ = _roundStartBlock;
        roundLiquidity_ = _getRoundLiquidity();
        hash_ = _roundHash;
        bets_ = _bets;

        if (_isIdle() || startBlock_ >= block.number) {
            blockHashes_ = new bytes32[](0);
        } else {
            uint64 length = uint64(block.number) - startBlock_;
            blockHashes_ = new bytes32[](length);

            for (uint64 i = 0; i < length; i++) {
                blockHashes_[i] = _getBlockHash(startBlock_ + i);
            }
        }
    }

    // ########################################################################################

    /// @notice Sets the active state of the game. Can only be called by the owner.
    /// @param active_ The new active state.
    /// @dev If the game is set to inactive, it will not allow the start of a new round.
    function setActive(bool active_) external onlyOwner {
        if (_active == active_) return;

        _active = active_;
        emit ActiveUpdated(active_);
    }

    /// @notice Sets the hash producer address. Can only be called by the owner.
    /// @param hashProducer_ The new hash producer address.
    function setHashProducer(address hashProducer_) external onlyOwner {
        _hashProducer = hashProducer_;
    }

    /// @notice Sets the number of intro blocks before the round starts. Can only be called by the owner.
    /// @param introBlocks_ The number of intro blocks.
    function setIntroBlocks(uint64 introBlocks_) external onlyOwner {
        _introBlocks = introBlocks_;
    }

    /// @notice Sets the loot table for the game. Can only be called by the owner.
    /// @param lootTable_ The new loot table to use.
    /// @dev If the game is currently idle, the loot table is set immediately. Otherwise, it is staged for the next round.
    function setLootTable(ILootTable lootTable_) external onlyOwner {
        if (_isIdle()) {
            _setLootTable(lootTable_);
        } else {
            _stagedLootTable = lootTable_;
        }
    }

    // ########################################################################################

    /// @notice Places a bet in the current round.
    /// @param _amount The amount to bet, must be greater than zero.
    /// @param _autoCashout The index of the auto cashout in the loot table.
    /// @dev If the round has not started, it will initialise the round.
    function placeBet(uint256 _amount, uint64 _autoCashout) external payable notZero(_amount) {
        if (_roundStartBlock == 0) {
            _initialiseRound();
        }

        // Ensure the bet is valid
        if (_roundStartBlock <= block.number) revert RoundInProgressError();
        if (_lootTable.getLength() <= _autoCashout) revert InvalidCashoutIndexError();

        // Ensure the user has enough funds
        _receiveValue(msg.sender, _amount);

        // Reduce the round liquidity by the users max win
        _useRoundLiquidity(_lootTable.multiply(_amount, _autoCashout));

        // Store the bet
        _bets.push(Bet(_amount, msg.sender, _autoCashout, false));

        // Emit an event for the bet placed
        emit BetPlaced(_roundHash, msg.sender, _amount, _autoCashout);
    }

    /// @notice Updates the auto cashout index for a bet.
    /// @param _index The index of the bet to update.
    /// @param _autoCashout The new auto cashout index in the loot table.
    function updateBet(uint256 _index, uint64 _autoCashout) external {
        Bet storage bet = _getBet(_index);

        // Ensure the update is valid
        if (_roundStartBlock <= block.number) revert RoundInProgressError();
        if (_lootTable.getLength() <= _autoCashout) revert InvalidCashoutIndexError();

        // Update the round liquidity
        _releaseRoundLiquidity(_lootTable.multiply(bet.amount, bet.cashoutIndex));
        _useRoundLiquidity(_lootTable.multiply(bet.amount, _autoCashout));

        // Update the bet
        bet.cashoutIndex = _autoCashout;

        // Emit an event for the bet updated
        emit BetCashoutUpdated(_roundHash, _index, _autoCashout);
    }

    /// @notice Cancels a bet and refunds the user.
    /// @param _index The index of the bet to cancel.
    function cancelBet(uint256 _index) external {
        Bet storage bet = _getBet(_index);

        // Ensure the game has not started
        if (_roundStartBlock <= block.number) revert RoundInProgressError();

        // Cancel the bet
        bet.cancelled = true;

        // Refund the bet
        _sendValue(msg.sender, bet.amount);

        // Update the round liquidity
        _releaseRoundLiquidity(_lootTable.multiply(bet.amount, bet.cashoutIndex));

        // Emit an event for the bet cancelled
        emit BetCancelled(_roundHash, _index);
    }

    /// @notice Allows a user to cash out their bet at the current block index.
    /// @param _index The index of the bet to cash out.
    function cashout(uint256 _index) external {
        Bet storage bet = _getBet(_index);

        // Ensure the game has started
        uint64 _bn = uint64(block.number);
        if (_bn < _roundStartBlock) revert RoundNotStartedError();

        // Ensure the user has not cashed out already
        uint64 blockIndex = _bn - _roundStartBlock;
        if (bet.cashoutIndex <= blockIndex) revert InvalidCashoutIndexError();

        bet.cashoutIndex = blockIndex;

        emit BetCashoutUpdated(_roundHash, _index, blockIndex);
    }

    /// @notice Reveals the round result and processes the bets. Can only be called by the hash producer.
    /// @param _salt The salt used to generate the round hash.
    /// @param _nextHash The hash for the next round.
    function reveal(bytes32 _salt, bytes32 _nextHash) external onlyHashProducer {
        if (keccak256(abi.encodePacked(_salt)) != _roundHash) revert InvalidHashError();

        uint64 deadIndex = _getDeadIndex(_salt);

        _processBets(deadIndex);
        _clearLiquidityQueue();

        emit RoundEnded(_roundHash, _salt, deadIndex);

        _roundStartBlock = 0;
        _roundHash = _nextHash;
        unchecked {
            _hashIndex++;
        }
    }

    // ########################################################################################

    function _canChangeLiquidity() internal view override returns (bool) {
        return _isIdle();
    }

    // ########################################################################################

    function _isIdle() private view returns (bool) {
        return _roundStartBlock == 0;
    }

    function _getBet(uint256 _index) private view returns (Bet storage bet_) {
        if (_index >= _bets.length) revert BetNotFoundError();

        bet_ = _bets[_index];

        if (bet_.user != msg.sender) revert BetNotYoursError();
        if (bet_.cancelled) revert BetCancelledError();
    }

    /// @dev The dead index is between 0 and the loot table length (inclusive). The final multiplier for the round is at deadIndex - 1. Unless it is 0, then the round has a 0x multiplier.
    function _getDeadIndex(bytes32 _salt) private view returns (uint64) {
        uint64 length = uint64(_lootTable.getLength());

        for (uint64 i = 0; i < length; i++) {
            // Generate a random number based on the salt and the block hash
            // The salt is unknown to block producers.
            // The block hash is unknown to the hash producer.
            uint256 rng = uint256(keccak256(abi.encodePacked(_salt, _getBlockHash(_roundStartBlock + i))));

            // Check if the generated random number is dead at this index
            if (_lootTable.isDead(rng, i)) {
                return i;
            }
        }

        // This happens when no dead index is found, meaning the round has ended with the maximum multiplier.
        return length;
    }

    function _getBlockHash(uint256 _blockNumber) private view returns (bytes32 blockHash_) {
        blockHash_ = blockhash(_blockNumber);
        if (blockHash_ == bytes32(0)) revert InvalidHashError();
    }

    function _initialiseRound() private {
        if (!_active) revert NotActiveError();

        // Apply the staged loot table if it exists
        if (_stagedLootTable != ILootTable(address(0))) {
            _setLootTable(_stagedLootTable);
            delete _stagedLootTable;
        }

        _roundStartBlock = uint64(block.number) + _introBlocks;
        emit RoundStarted(_roundHash, _roundStartBlock, _hashIndex);
    }

    function _setLootTable(ILootTable lootTable_) private {
        _lootTable = lootTable_;
        emit LootTableUpdated(lootTable_);
    }

    function _processBets(uint64 _deadIndex) internal {
        for (uint256 i = 0; i < _bets.length; i++) {
            Bet storage bet = _bets[i];

            if (!bet.cancelled && bet.cashoutIndex < _deadIndex) {
                _sendValue(bet.user, _lootTable.multiply(bet.amount, bet.cashoutIndex));
            }
        }

        delete _bets;
    }
}
