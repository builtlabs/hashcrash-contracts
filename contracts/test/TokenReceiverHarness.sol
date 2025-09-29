// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { TokenReceiver } from "../lib/TokenReceiver.sol";

contract TokenReceiverHarness is TokenReceiver {
    function approveToken(address token_, address to_, uint256 amount_) external {
        _approveToken(token_, to_, amount_);
    }

    function receiveToken(address token_, uint256 amount_) external payable {
        _receiveToken(token_, amount_);
    }

    function sendToken(address token_, address to_, uint256 amount_) external {
        _sendToken(token_, to_, amount_);
    }
}
