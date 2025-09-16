// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { TokenHolder } from "../currency/TokenHolder.sol";

contract TokenHolderHarness is TokenHolder {
    uint256 private _balance;

    event ReceivedValue(uint256 value);

    // #######################################################################################

    constructor(address _token, uint256 minimumValue_) TokenHolder(_token, minimumValue_) Ownable(msg.sender) {}

    // #######################################################################################

    function t_enforceMinimum(uint256 _value) external enforceMinimum(_value) {
        // This function is just to test the enforceMinimum modifier.
    }

    function getBalance() external view returns (uint256) {
        return _getBalance();
    }

    function stageAmount(uint256 _amount) external {
        _stageAmount(_amount);
    }

    function unstageAmount(uint256 _amount) external {
        _unstageAmount(_amount);
    }

    function ensureMinimum(uint256 _value) external view {
        _ensureMinimum(_value);
    }

    function receiveValue(uint256 _value) external {
        emit ReceivedValue(_receiveValue(msg.sender, _value));
    }

    function sendValue(address _to, uint256 _value) external {
        _sendValue(_to, _value);
    }
}
