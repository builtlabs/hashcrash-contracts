// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ERC20Holder {
    function _approveToken(address token_, address to_, uint256 amount_) internal {
        IERC20(token_).approve(to_, amount_);
    }

    function _receiveToken(address token_, uint256 amount_) internal returns (uint256) {
        if (amount_ > 0) {
            SafeERC20.safeTransferFrom(IERC20(token_), msg.sender, address(this), amount_);
        }

        return amount_;
    }

    function _sendToken(address token_, address to_, uint256 amount_) internal {
        if (amount_ > 0) {
            SafeERC20.safeTransfer(IERC20(token_), to_, amount_);
        }
    }

    // #######################################################################################

    function _tokenBalance(address token_) internal view returns (uint256) {
        return IERC20(token_).balanceOf(address(this));
    }
}
