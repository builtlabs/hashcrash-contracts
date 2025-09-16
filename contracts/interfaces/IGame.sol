// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IGame
/// @notice
interface IGame {
    function processBet(address placedBy_, address token_, uint256 amount_, bytes calldata data_) external;
}
