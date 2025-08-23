// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IWETH } from "../interfaces/IWETH.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TokenReceiver {
    address private immutable WETH;

    // #######################################################################################

    error TokenDoesNotWrap(address token);

    // #######################################################################################

    constructor(address _WETH) {
        WETH = _WETH;
    }

    // #######################################################################################

    function _receiveValue(address token_, uint256 amount_) internal returns (uint256) {
        if (amount_ > 0) {
            SafeERC20.safeTransferFrom(IERC20(token_), msg.sender, address(this), amount_);
        }

        if (msg.value > 0) {
            if (token_ != WETH) revert TokenDoesNotWrap(token_);

            IWETH(token_).deposit{ value: msg.value }();

            unchecked {
                amount_ += msg.value;
            }
        }

        return amount_;
    }

    function _sendValue(address token_, address to_, uint256 amount_) internal {
        if (amount_ > 0) {
            SafeERC20.safeTransfer(IERC20(token_), to_, amount_);
        }
    }
}
