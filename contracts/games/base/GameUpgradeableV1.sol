// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IGame } from "../../interfaces/IGame.sol";
import { ILiquidityPool } from "../../interfaces/ILiquidityPool.sol";

abstract contract GameUpgradeableV1 is IGame {
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    ILiquidityPool immutable LIQUIDITY;

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

    struct GameStorage {
        mapping(uint256 => uint256) borrowed;
    }

    // keccak256("hashcrash.storage.GameUpgradeable")
    bytes32 private constant GameStorageLocation = 0xe1473c9651f1082defdb29145c3601550f958fb43a1a0757448f0d1aab86440d;

    function _getGameStorage() private pure returns (GameStorage storage $) {
        assembly {
            $.slot := GameStorageLocation
        }
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

    function _maxExposure(address token_) internal view returns (uint256) {
        return LIQUIDITY.getMaxExposure(token_);
    }

    function _requestLiquidity(address token_, uint256 amount_) internal returns (uint256 requestId, uint256 amount) {
        (requestId, amount) = LIQUIDITY.requestLiquidity(token_, amount_);
        _setBorrowed(requestId, amount);
    }

    function _settleLiquidityRequest(
        uint256 requestId_,
        address token_,
        uint256 incoming_,
        uint256 outgoing_
    ) internal {
        _sendValue(token_, address(LIQUIDITY), incoming_ + _getBorrowed(requestId_) - outgoing_);
        LIQUIDITY.settleLiquidityRequest(requestId_, token_, incoming_, outgoing_);
    }

    function _sendValue(address token_, address to_, uint256 amount_) internal {
        SafeERC20.safeTransfer(IERC20(token_), to_, amount_);
    }

    // #######################################################################################

    function _getBorrowed(uint256 requestId_) private view returns (uint256) {
        return _getGameStorage().borrowed[requestId_];
    }

    function _setBorrowed(uint256 requestId_, uint256 amount_) private {
        _getGameStorage().borrowed[requestId_] = amount_;
    }
}
