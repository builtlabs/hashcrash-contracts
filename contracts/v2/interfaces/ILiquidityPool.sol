// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ILiquidityPool
/// @notice TODO
interface ILiquidityPool {
    function requestLiquidity(address token_, uint256 amount_) external returns (uint256 requestId, uint256 amount);

    function settleLiquidityRequest(uint256 requestId_, address token_, uint256 incoming_, uint256 outgoing_) external;
}
