// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HashCrash } from "../HashCrash.sol";
import { TokenHolder } from "../currency/TokenHolder.sol";
import { WrappedContext } from "../currency/WrappedContext.sol";

/// @title HashCrashNative
/// @notice A hashcrash implementation using the chains native token.
contract HashCrashNative is HashCrash, WrappedContext {
    constructor(
        address lootTable_,
        bytes32 genesisHash_,
        address hashProducer_,
        uint64 maxExposureNumerator_,
        uint256 lowLiquidityThreshold_,
        address owner_,
        address token_,
        uint256 minimumValue_
    )
        HashCrash(lootTable_, genesisHash_, hashProducer_, maxExposureNumerator_, lowLiquidityThreshold_, owner_)
        TokenHolder(token_, minimumValue_)
        WrappedContext(token_)
    {}

    function _receiveValue(address _from, uint256 _tokenValue) internal override returns (uint256) {
        return _nativeToWrapped() + super._receiveValue(_from, _tokenValue);
    }
}
