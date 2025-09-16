// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ILegacyCrash
/// @notice TODO
interface ILegacyCrash {
    function getHashIndex() external view returns (uint64);

    function getRoundHash() external view returns (bytes32);
}
