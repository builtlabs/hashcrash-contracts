// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract WrappedContext {
    address private immutable _weth;

    // #######################################################################################

    error NativeToWrappedFailed();

    // #######################################################################################

    constructor(address weth_) {
        _weth = weth_;
    }

    // #######################################################################################

    function getWETH() external view returns (address) {
        return _getWETH();
    }

    // #######################################################################################

    function _getWETH() internal view returns (address) {
        return _weth;
    }

    function _nativeToWrapped() internal returns (uint256) {
        if (msg.value > 0) {
            (bool success, ) = _weth.call{ value: msg.value }("");
            if (!success) {
                revert NativeToWrappedFailed();
            }
        }

        return msg.value;
    }
}
