// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IWETH } from "../interfaces/IWETH.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TokenReceiver {
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
        if (amount_ > 0) {
            SafeERC20.safeTransferFrom(IERC20(token_), msg.sender, address(this), amount_);
        }

        if (msg.value > 0) {
            if (token_ != _WETH) revert TokenDoesNotWrap(token_);

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
