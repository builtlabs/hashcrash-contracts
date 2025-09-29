// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ValueReceiver } from "../lib/ValueReceiver.sol";

contract ValueReceiverHarness is ValueReceiver {
    event ReceiveReturn(uint256 value);

    constructor(address weth_) ValueReceiver(weth_) {}

    function receiveValue(address token_, uint256 amount_) external payable {
        emit ReceiveReturn(_receiveValue(token_, amount_));
    }
}
