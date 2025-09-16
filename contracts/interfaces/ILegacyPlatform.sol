// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ILegacyPlatform
/// @notice TODO
interface ILegacyPlatform {
    function getReferredBy(address _user) external view returns (address);
}
