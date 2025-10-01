// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ILiquidityPool } from "../interfaces/ILiquidityPool.sol";

contract MockLiquidity is ILiquidityPool {
    uint256 mockRequestId;
    mapping(address => uint256) mockExposure;

    event RequestLiquidity(address token_, uint256 amount_, uint256 requestId_);
    event SettleRequestedLiquidity(uint256 requestId_, address token_, uint256 incoming_, uint256 outgoing_);

    function setMockRequestId(uint256 requestId_) external {
        mockRequestId = requestId_;
    }

    function setMockExposure(address token_, uint256 exposure_) external {
        mockExposure[token_] = exposure_;
    }

    // #######################################################################################

    function getMaxExposure(address token_) external view returns (uint256) {
        return mockExposure[token_];
    }

    function requestLiquidity(address token_, uint256 amount_) external returns (uint256 requestId, uint256 amount) {
        emit RequestLiquidity(token_, amount_, mockRequestId);
        return (mockRequestId, amount_);
    }

    function settleLiquidityRequest(uint256 requestId_, address token_, uint256 incoming_, uint256 outgoing_) external {
        emit SettleRequestedLiquidity(requestId_, token_, incoming_, outgoing_);
    }
}
