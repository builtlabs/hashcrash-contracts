// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { NativeHolder } from "../lib/NativeHolder.sol";

contract NativeHolderHarness is NativeHolder {
    event ReceiveReturn(uint256 value);

    constructor(address weth_) NativeHolder(weth_) {}

    function receiveEther(address token_) external payable {
        emit ReceiveReturn(_receiveEther(token_));
    }

    function sendEther(address payable to_, uint256 amount_) external {
        _sendEther(to_, amount_);
    }

    function unwrapWETH(uint256 amount_) external {
        _unwrapWETH(amount_);
    }

    function isWETH(address token_) external view returns (bool) {
        return _isWETH(token_);
    }

    receive() external payable {}
}
