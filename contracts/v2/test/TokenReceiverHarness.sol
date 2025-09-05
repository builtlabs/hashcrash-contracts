// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { TokenReceiver } from "../lib/TokenReceiver.sol";

contract TokenReceiverHarness is TokenReceiver {
    event ReceiveReturn(uint256 value);

    constructor(address weth_) TokenReceiver(weth_) {}

    function receiveValue(address token_, uint256 amount_) external payable {
        emit ReceiveReturn(_receiveValue(token_, amount_));
    }

    function sendValue(address token_, address to_, uint256 amount_) external {
        _sendValue(token_, to_, amount_);
    }
}
