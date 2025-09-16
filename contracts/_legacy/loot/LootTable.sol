// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ILootTable } from "../interfaces/ILootTable.sol";

/// @title LootTable
/// @notice The base class each loot table must follow.
abstract contract LootTable is ILootTable {
    uint256 private constant MULTIPLIER_DENOMINATOR = 1e6;
    uint256 private constant PROBABILITY_DENOMINATOR = 1e18;

    error MissingBlockhash();
    error BlockHashesDontMatchProof();

    // #######################################################################################

    modifier validIndex(uint256 _index) {
        if (_index + 1 > _getLength()) revert InvalidIndex();
        _;
    }

    // #######################################################################################

    /// @notice Returns the length of the loot table.
    function getLength() external pure returns (uint256) {
        return _getLength();
    }

    /// @notice Returns an array of the multipliers, denominated in 1e6.
    function getMultipliers() external pure returns (uint256[] memory) {
        uint256 length = _getLength();

        uint256[] memory multipliers = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            multipliers[i] = _multiplier(i);
        }
        return multipliers;
    }

    /// @notice Returns an array containing the death probabilities, denominated in 1e18.
    function getProbabilities() external pure returns (uint256[] memory) {
        uint256 length = _getLength();

        uint256[] memory probabilities = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            probabilities[i] = _probability(i);
        }
        return probabilities;
    }

    /// @notice Returns the given value multiplied by the multiplier at the given index.
    function multiply(uint256 _value, uint256 _index) external pure validIndex(_index) returns (uint256) {
        return (_value * _multiplier(_index)) / MULTIPLIER_DENOMINATOR;
    }

    /// @notice Returns whether the given random number results in death at the given index.
    function isDead(uint256 _rng, uint256 _index) external pure validIndex(_index) returns (bool) {
        return _isDead(_rng, _index);
    }

    /// @notice Returns the dead index for a given salt and a proof to check against later.
    /// @dev The dead index is between 0 and the loot table length (inclusive).
    /// @dev The final multiplier for the round is at deadIndex - 1. Unless it is 0, then the round has a 0x multiplier.
    function getDeathProof(
        bytes32 _salt,
        uint256 _roundStartBlock
    ) external view returns (uint64 deadIndex, bytes32 proof) {
        uint64 length = uint64(_getLength());
        bytes32[] memory hashes = new bytes32[](length);

        for (uint64 i = 0; i < length; i++) {
            // Generate a random number based on the salt and the block hash
            // The salt is unknown to block producers.
            // The block hash is unknown to the hash producer.
            hashes[i] = _getBlockHash(_roundStartBlock + i);
            uint256 rng = uint256(keccak256(abi.encodePacked(_salt, hashes[i])));

            // Check if the generated random number is dead at this index
            if (_isDead(rng, i)) {
                bytes32[] memory usedHashes = new bytes32[](i + 1);

                for (uint64 j = 0; j <= i; j++) {
                    usedHashes[j] = hashes[j];
                }

                return (i, _getProofHash(_salt, usedHashes));
            }
        }

        // This happens when no dead index is found, meaning the round has ended with the maximum multiplier.
        return (length, _getProofHash(_salt, hashes));
    }

    // #######################################################################################

    function _getLength() internal pure virtual returns (uint256);

    function _multiplier(uint256 _index) internal pure virtual returns (uint256);

    function _probability(uint256 _index) internal pure virtual returns (uint256);

    // #######################################################################################

    function _getProofHash(bytes32 _salt, bytes32[] memory _hashes) private view returns (bytes32) {
        return keccak256(abi.encode(address(this), _salt, _hashes));
    }

    function _isDead(uint256 _rng, uint256 _index) private pure returns (bool) {
        return _rng % PROBABILITY_DENOMINATOR < _probability(_index);
    }

    function _getBlockHash(uint256 _blockNumber) private view returns (bytes32 blockHash_) {
        blockHash_ = blockhash(_blockNumber);
        if (blockHash_ == bytes32(0)) revert MissingBlockhash();
    }
}
