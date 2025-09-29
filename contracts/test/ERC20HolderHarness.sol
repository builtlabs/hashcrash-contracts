// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20Holder } from "../lib/ERC20Holder.sol";

contract ERC20HolderHarness is ERC20Holder {
    event ReceiveReturn(uint256 value);

    function approveToken(address token_, address to_, uint256 amount_) external {
        _approveToken(token_, to_, amount_);
    }

    function receiveToken(address token_, uint256 amount_) external payable {
        emit ReceiveReturn(_receiveToken(token_, amount_));
    }

    function sendToken(address token_, address to_, uint256 amount_) external {
        _sendToken(token_, to_, amount_);
    }

    function tokenBalance(address token_) external view returns (uint256) {
        return _tokenBalance(token_);
    }
}
