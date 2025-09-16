// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ValueHolder
/// @notice A base contract capable of holding and managing a given ERC20 token.
abstract contract TokenHolder is Ownable {
    IERC20 private immutable _token;

    uint256 private _stagedBalance;
    uint256 private _minimum;

    // #######################################################################################

    event StagedBalanceIncreased(uint256 amount);
    event StagedBalanceDecreased(uint256 amount);

    error InvalidValue(uint256 value);
    error InvalidAddress(address addr);
    error ValueBelowMinimum(uint256 value);
    error InsufficientStagedBalance(uint256 have, uint256 need);
    error InsufficientAvailableBalance(uint256 have, uint256 need);

    // #######################################################################################

    modifier enforceMinimum(uint256 _value) {
        _ensureMinimum(_value);
        _;
    }

    // #######################################################################################

    constructor(address token_, uint256 _minimumValue) {
        _token = IERC20(token_);
        _setMinimum(_minimumValue);
    }

    // #######################################################################################

    /// @notice Returns the address of the ERC20 token used by this contract.
    function token() external view returns (address) {
        return address(_token);
    }

    /// @notice Returns the reserved balance held within this contract.
    function getStagedBalance() external view returns (uint256) {
        return _stagedBalance;
    }

    /// @notice Returns the minimum value that can be used.
    function getMinimum() external view returns (uint256) {
        return _getMinimum();
    }

    /// @notice Returns the available balance held within this contract.
    function getAvailableBalance() external view returns (uint256) {
        return _getAvailableBalance();
    }

    // #######################################################################################

    /// @notice Sets the minimum value that can be used.
    function setMinimum(uint256 _minimumValue) external onlyOwner {
        _setMinimum(_minimumValue);
    }

    /// @notice allows for the rescue of tokens that are not the primary token of this contract.
    /// @param _toRescue The address of the token to rescue.
    function rescueTokens(IERC20 _toRescue, address _to) external onlyOwner {
        uint256 tokenBalance = _toRescue.balanceOf(address(this));

        if (_token == _toRescue || tokenBalance == 0) revert InvalidAddress(address(_toRescue));
        SafeERC20.safeTransfer(_toRescue, _to, tokenBalance);
    }

    // #######################################################################################

    function _stageAmount(uint256 _amount) internal {
        unchecked {
            _stagedBalance += _amount;
        }

        emit StagedBalanceIncreased(_amount);
    }

    function _unstageAmount(uint256 _amount) internal {
        uint256 staged = _stagedBalance;
        if (staged < _amount) {
            revert InsufficientStagedBalance(staged, _amount);
        }

        unchecked {
            _stagedBalance = staged - _amount;
        }

        emit StagedBalanceDecreased(_amount);
    }

    function _setMinimum(uint256 _minimumValue) internal {
        if (_minimumValue == 0) revert InvalidValue(_minimumValue);
        _minimum = _minimumValue;
    }

    function _getMinimum() internal view returns (uint256) {
        return _minimum;
    }

    function _ensureMinimum(uint256 _value) internal view {
        if (_value < _getMinimum()) revert ValueBelowMinimum(_value);
    }

    function _getAvailableBalance() internal view returns (uint256) {
        return _getBalance() - _stagedBalance;
    }

    function _getBalance() internal view returns (uint256) {
        return _token.balanceOf(address(this));
    }

    function _sendValue(address _to, uint256 _value) internal {
        uint256 available = _getAvailableBalance();
        if (available < _value) {
            revert InsufficientAvailableBalance(available, _value);
        }

        SafeERC20.safeTransfer(_token, _to, _value);
    }

    // #######################################################################################

    function _receiveValue(address _from, uint256 _tokenValue) internal virtual returns (uint256) {
        if (_tokenValue > 0) {
            SafeERC20.safeTransferFrom(_token, _from, address(this), _tokenValue);
        }
        return _tokenValue;
    }
}
