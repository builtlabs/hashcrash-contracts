// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IVRFSystem } from "../interfaces/IVRFSystem.sol";
import { IVRFSystemCallback } from "../interfaces/IVRFSystemCallback.sol";

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract vRNGForwarder is IVRFSystemCallback, Ownable {
    error UnauthorizedRequest();

    IVRFSystem private immutable _vRNG;
    IVRFSystemCallback private _forwardTo;

    constructor(IVRFSystem vRNG_, address owner_) Ownable(owner_) {
        _vRNG = vRNG_;
    }

    function setForwardTo(IVRFSystemCallback forwardTo_) external onlyOwner {
        _forwardTo = forwardTo_;
    }

    function requestRandomNumberWithTraceId(uint256 traceId) external returns (uint256) {
        if (msg.sender != address(_forwardTo)) revert UnauthorizedRequest();
        return _vRNG.requestRandomNumberWithTraceId(traceId);
    }

    function randomNumberCallback(uint256 requestId, uint256 randomNumber) external override {
        if (msg.sender != address(_vRNG)) revert UnauthorizedRequest();

        if (address(_forwardTo) != address(0)) {
            _forwardTo.randomNumberCallback(requestId, randomNumber);
        }
    }
}
