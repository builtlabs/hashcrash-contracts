// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IWETH } from "../interfaces/IWETH.sol";

contract NativeHolder {
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable _WETH;

    // #######################################################################################

    error FailedToTransferEther();
    error TokenDoesNotWrap(address token);

    // #######################################################################################

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address weth_) {
        _WETH = weth_;
    }

    // #######################################################################################

    function getWeth() external view returns (address) {
        return _WETH;
    }

    // #######################################################################################

    function _receiveEther(address token_) internal returns (uint256) {
        if (msg.value > 0) {
            if (token_ != _WETH) revert TokenDoesNotWrap(token_);
            IWETH(token_).deposit{ value: msg.value }();
        }

        return msg.value;
    }

    function _sendEther(address payable _to, uint256 _amount) internal {
        if (_amount > 0) {
            (bool success, ) = _to.call{ value: _amount }("");
            if (!success) revert FailedToTransferEther();
        }
    }

    function _unwrapWETH(uint256 amount_) internal {
        if (amount_ > 0) {
            IWETH(_WETH).withdraw(amount_);
        }
    }

    // #######################################################################################

    function _isWETH(address token_) internal view returns (bool) {
        return token_ == _WETH;
    }
}
