// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ILootTable
/// @notice An interface defining a loot table for a probability based game.
interface ILootTable {
    error InvalidIndex();

    /// @notice Returns the length of the loot table.
    function getLength() external pure returns (uint256);

    /// @notice Returns an array of the multipliers, denominated in 1e6.
    function getMultipliers() external pure returns (uint256[] memory);

    /// @notice Returns an array containing the death probabilities, denominated in 1e18.
    function getProbabilities() external pure returns (uint256[] memory);

    /// @notice Returns the given value multiplied by the multiplier at the given index.
    function multiply(uint256 _value, uint256 _index) external pure returns (uint256);

    /// @notice Returns whether the given random number results in death at the given index.
    function isDead(uint256 _rng, uint256 _index) external pure returns (bool);

    /// @notice Returns the dead index for a given salt and a proof to check against later.
    function getDeathProof(
        bytes32 _salt,
        uint256 _roundStartBlock
    ) external view returns (uint64 deadIndex, bytes32 proof);
}
