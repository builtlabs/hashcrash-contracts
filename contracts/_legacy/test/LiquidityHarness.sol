// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Liquidity } from "../liquidity/Liquidity.sol";
import { TokenHolder } from "../currency/TokenHolder.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract LiquidityHarness is Liquidity {
    event OnLowLiquidity();

    bool public canChangeLiquidity;
    IERC20 private _token;

    // #######################################################################################

    constructor(
        uint64 maxExposureNumerator_,
        uint256 lowLiquidityThreshold_,
        address token_,
        uint256 minimumValue_
    ) Liquidity(maxExposureNumerator_, lowLiquidityThreshold_) TokenHolder(token_, minimumValue_) Ownable(msg.sender) {
        _token = IERC20(token_);
    }

    // #######################################################################################

    function fillLiquidityQueue(uint256 _amount, uint256 _queueLength) external {
        bool prev = canChangeLiquidity;
        canChangeLiquidity = false;

        for (uint256 i = 0; i < _queueLength; i++) {
            UniqueLiquidityDepositor depositor = new UniqueLiquidityDepositor();
            _sendValue(address(depositor), _amount);
            depositor.deposit(this, _token, _amount);
        }

        canChangeLiquidity = prev;
    }

    function mockLoss(uint256 _amount) external {
        _sendValue(msg.sender, _amount);
    }

    function mockCanChangeLiquidity(bool _value) external {
        canChangeLiquidity = _value;
    }

    function clearLiquidityQueue() external {
        _clearLiquidityQueue();
    }

    function useRoundLiquidity(uint256 _amount) external {
        _useRoundLiquidity(_amount);
    }

    function releaseRoundLiquidity(uint256 _amount) external {
        _releaseRoundLiquidity(_amount);
    }

    // #######################################################################################

    function _canChangeLiquidity() internal view override returns (bool) {
        return canChangeLiquidity;
    }

    function _onLowLiquidity() internal override {
        emit OnLowLiquidity();
        super._onLowLiquidity();
    }
}

contract UniqueLiquidityDepositor {
    function deposit(Liquidity _target, IERC20 _token, uint256 _amount) external {
        _token.approve(address(_target), _amount);
        _target.deposit(_amount);
    }
}
