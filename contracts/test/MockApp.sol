// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ILiquidityPool } from "../interfaces/ILiquidityPool.sol";

contract MockApp {
    ILiquidityPool public liquidityPool;

    event LiquidityRequested(uint256 requestId, uint256 amount);

    constructor(address liquidityPool_) {
        liquidityPool = ILiquidityPool(liquidityPool_);
    }

    function requestLiquidity(address token_, uint256 amount_) external {
        (uint256 requestId, uint256 amount) = liquidityPool.requestLiquidity(token_, amount_);
        emit LiquidityRequested(requestId, amount);
    }

    function settleLiquidityRequest(uint256 requestId_, address token_, uint256 incoming_, uint256 outgoing_) external {
        liquidityPool.settleLiquidityRequest(requestId_, token_, incoming_, outgoing_);
    }
}
