// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20Holder } from "../../lib/ERC20Holder.sol";

import { IGame } from "../../interfaces/IGame.sol";
import { ILiquidityPool } from "../../interfaces/ILiquidityPool.sol";

abstract contract GameUpgradeableV1 is IGame, ERC20Holder {
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address immutable LIQUIDITY;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address immutable RANDOMNESS;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
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
        LIQUIDITY = liquidity_;
    }

    // #######################################################################################

    function enableToken(address token_) external onlyPlatform {
        _approveToken(token_, LIQUIDITY, type(uint256).max);
    }

    // #######################################################################################

    function processBet(
        address placedBy_,
        address token_,
        uint256 amount_,
        bytes calldata data_
    ) external onlyPlatform {
        _receiveToken(token_, amount_);
        _processBet(placedBy_, token_, amount_, data_);
    }

    // #######################################################################################

    function _processBet(address placedBy_, address token_, uint256 amount_, bytes calldata data_) internal virtual;

    // #######################################################################################

    function _maxExposure(address token_) internal view returns (uint256) {
        return ILiquidityPool(LIQUIDITY).getMaxExposure(token_);
    }

    function _requestLiquidity(address token_, uint256 amount_) internal returns (uint256 requestId, uint256 amount) {
        (requestId, amount) = ILiquidityPool(LIQUIDITY).requestLiquidity(token_, amount_);
    }

    function _settleLiquidityRequest(
        uint256 requestId_,
        address token_,
        uint256 incoming_,
        uint256 outgoing_
    ) internal {
        ILiquidityPool(LIQUIDITY).settleLiquidityRequest(requestId_, token_, incoming_, outgoing_);
    }
}
