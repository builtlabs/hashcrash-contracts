// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IVRFSystem } from "../interfaces/IVRFSystem.sol";
import { IVRFSystemCallback } from "../interfaces/IVRFSystemCallback.sol";

contract MockVRFSystem is IVRFSystem {
    event RandomNumberRequested(uint256 indexed requestId, uint256 traceId);

    uint256 private _currentRequestId = 10;

    function getNextRequestId() external view returns (uint256) {
        return _currentRequestId + 1;
    }

    function requestRandomNumberWithTraceId(uint256 traceId) external returns (uint256) {
        _currentRequestId++;
        emit RandomNumberRequested(_currentRequestId, traceId);
        return _currentRequestId;
    }

    function fulfillRandomNumber(uint256 requestId, uint256 randomNumber, IVRFSystemCallback callback) external {
        require(requestId <= _currentRequestId, "Invalid request ID");
        callback.randomNumberCallback(requestId, randomNumber);
    }
}
