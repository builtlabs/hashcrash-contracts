// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IWETH } from "../interfaces/IWETH.sol";
import { TokenReceiver } from "./TokenReceiver.sol";

contract ValueReceiver is TokenReceiver {
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable _WETH;

    // #######################################################################################

    error TokenDoesNotWrap(address token);

    // #######################################################################################

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address weth_) {
        _WETH = weth_;
    }

    // #######################################################################################

    function getWeth() external view returns (address) {
        return _wethAddress();
    }

    // #######################################################################################

    function _wethAddress() internal view returns (address) {
        return _WETH;
    }

    function _receiveValue(address token_, uint256 amount_) internal returns (uint256) {
        _receiveToken(token_, amount_);

        if (msg.value > 0) {
            if (token_ != _WETH) revert TokenDoesNotWrap(token_);

            IWETH(token_).deposit{ value: msg.value }();

            unchecked {
                amount_ += msg.value;
            }
        }

        return amount_;
    }
}
