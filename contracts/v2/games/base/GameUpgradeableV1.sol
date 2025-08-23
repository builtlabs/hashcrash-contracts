// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IGame } from "../../interfaces/IGame.sol";
import { ILiquidityPool } from "../../interfaces/ILiquidityPool.sol";

abstract contract GameUpgradeableV1 is IGame {
    ILiquidityPool immutable LIQUIDITY;
    address immutable RANDOMNESS;
    address immutable PLATFORM;

    // #######################################################################################

    error CallerNotPlatform();
    error CallerNotRandomness();

    // #######################################################################################

    modifier onlyPlatform() {
        if (msg.sender != PLATFORM) revert CallerNotPlatform();
        _;
    }

    modifier onlyRandomness() {
        if (msg.sender != RANDOMNESS) revert CallerNotRandomness();
        _;
    }

    // #######################################################################################

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address platform_, address randomness_, address liquidity_) {
        PLATFORM = platform_;
        RANDOMNESS = randomness_;
        LIQUIDITY = ILiquidityPool(liquidity_);
    }

    // #######################################################################################

    function processBet(
        address placedBy_,
        address token_,
        uint256 amount_,
        bytes calldata data_
    ) external onlyPlatform {
        _processBet(placedBy_, token_, amount_, data_);
    }

    // #######################################################################################

    function _processBet(address placedBy_, address token_, uint256 amount_, bytes calldata data_) internal virtual;

    // #######################################################################################

    function _requestLiquidity(address token_, uint256 amount_) internal returns (uint256 requestId, uint256 amount) {
        return LIQUIDITY.requestLiquidity(token_, amount_);
    }

    function _settleLiquidityRequest(
        uint256 requestId_,
        address token_,
        uint256 incoming_,
        uint256 outgoing_
    ) internal {
        LIQUIDITY.settleLiquidityRequest(requestId_, token_, incoming_, outgoing_);
    }
}
