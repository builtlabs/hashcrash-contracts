// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IVRFSystem } from "../interfaces/IVRFSystem.sol";
import { IVRFSystemCallback } from "../interfaces/IVRFSystemCallback.sol";

contract RandomnessDummy is IVRFSystemCallback {
    error UnauthorizedRequest();

    IVRFSystem private immutable _vRNG;

    event RandomNumberRequested(uint256 requestId, uint256 traceId);
    event RandomNumberReceived(uint256 requestId, uint256 randomNumber);

    constructor(IVRFSystem vRNG_) {
        _vRNG = vRNG_;
    }

    function requestRandomNumberWithTraceId(uint256 traceId) external {
        emit RandomNumberRequested(_vRNG.requestRandomNumberWithTraceId(traceId), traceId);
    }

    function randomNumberCallback(uint256 requestId, uint256 randomNumber) external override {
        if (msg.sender != address(_vRNG)) revert UnauthorizedRequest();
        emit RandomNumberReceived(requestId, randomNumber);
    }
}
