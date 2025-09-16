// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { WrappedContext } from "../currency/WrappedContext.sol";

contract WrappedContextHarness is WrappedContext {
    event NativeToWrappedCalled(uint256 amount);

    constructor(address weth_) WrappedContext(weth_) {}

    function nativeToWrapped() external payable {
        emit NativeToWrappedCalled(_nativeToWrapped());
    }
}
