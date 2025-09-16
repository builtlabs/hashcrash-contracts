// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { TokenHolder } from "../currency/TokenHolder.sol";

/// @title Liquidity
/// @notice A base contract for managing liquidity.
abstract contract Liquidity is TokenHolder {
    uint64 constant _MAX_LIQUIDITY_QUEUE_SIZE = 64;
    uint256 constant _DENOMINATOR = 10000;

    // #######################################################################################

    event LiquidityAdded(address indexed user, uint256 tokenDelta, uint256 shareDelta);
    event LiquidityRemoved(address indexed user, uint256 tokenDelta, uint256 shareDelta);

    event LiquidityChangeQueued(uint64 indexed nonce, address indexed user, uint8 action, uint256 amount);
    event LiquidityQueueCleared(uint64 indexed nonce);

    event MaxExposureUpdated(uint64 newMaxExposure);
    event LowLiquidityThresholdUpdated(uint256 newThreshold);

    error OneChangePerRound();
    error LiquidityQueueFull();
    error InsufficientShares();
    error InsufficientLiquidity();

    struct LiquidityDelta {
        uint8 action; // 0 = add, 1 = remove
        address user;
        uint256 amount;
    }

    struct User {
        uint192 shares;
        uint64 queueNonce;
    }

    // #######################################################################################

    mapping(uint256 => LiquidityDelta) private _liquidityQueue;
    uint64 private _liquidityQueueLength;
    uint64 private _liquidityQueueNonce;
    uint64 private _maxExposureNumerator;

    uint256 private _availableLiquidity;
    uint256 private _lowLiquidityThreshold;

    mapping(address => User) private _users;
    uint256 private _totalShares;

    // #######################################################################################

    /// @notice Constructor sets the initial max liquidity exposure to 10% and the low liquidity threshold.
    /// @param maxExposureNumerator_ The numerator for the maximum exposure, must be between 100 and 5000 (1% to 50%).
    /// @param lowLiquidityThreshold_ The threshold below which the parent is notified the _availableLiquidity is low.
    constructor(uint64 maxExposureNumerator_, uint256 lowLiquidityThreshold_) {
        _setMaxExposure(maxExposureNumerator_);
        _setLowLiquidityThreshold(lowLiquidityThreshold_);

        _liquidityQueueNonce = 1; // Start at 1 to avoid conflicts with the initial user queue nonce.
    }

    // #######################################################################################

    /// @notice Sets the maximum exposure numerator.
    /// @param _numerator The numerator for the maximum exposure, must be between 100 and 5000 (1% to 50%).
    function setMaxExposure(uint64 _numerator) external onlyOwner {
        _setMaxExposure(_numerator);
    }

    /// @notice Sets the low liquidity threshold.
    /// @param _value The new low liquidity threshold.
    function setLowLiquidityThreshold(uint128 _value) external onlyOwner {
        _setLowLiquidityThreshold(_value);
    }

    // #######################################################################################

    /// @notice Returns the current available liquidity.
    function getAvailableLiquidity() external view returns (uint256) {
        return _getAvailableLiquidity();
    }

    /// @notice Returns the current maximum exposure numerator.
    function getMaxExposureNumerator() external view returns (uint64) {
        return _maxExposureNumerator;
    }

    /// @notice Returns the current low liquidity threshold.
    function getLowLiquidityThreshold() external view returns (uint256) {
        return _lowLiquidityThreshold;
    }

    /// @notice Returns the total number of shares across all users.
    function getTotalShares() external view returns (uint256) {
        return _totalShares;
    }

    /// @notice Returns the number of shares held by the given user.
    function getUserShares(address _user) external view returns (uint256) {
        return _users[_user].shares;
    }

    /// @notice Returns the liquidity queue nonce of the given user.
    function getUserLiquidityQueueNonce(address _user) external view returns (uint64) {
        return _users[_user].queueNonce;
    }

    /// @notice Returns the current liquidity queue nonce.
    function getLiquidityQueueNonce() external view returns (uint64) {
        return _liquidityQueueNonce;
    }

    /// @notice Returns the current length of the liquidity queue.
    function getLiquidityQueueLength() external view returns (uint64) {
        return _liquidityQueueLength;
    }

    /// @notice Returns the current liquidity changes waiting to be applied.
    function getLiquidityQueue() external view returns (LiquidityDelta[] memory) {
        LiquidityDelta[] memory queue = new LiquidityDelta[](_liquidityQueueLength);

        for (uint256 i = 0; i < queue.length; ) {
            queue[i] = _liquidityQueue[i];

            unchecked {
                i++;
            }
        }

        return queue;
    }

    // #######################################################################################

    /// @notice Either deposits, or queues a deposit of the given amount by the sender.
    /// @param _amount The token amount to deposit.
    function deposit(uint256 _amount) external payable {
        // Wrap any native ether, standardize behavior between weth and other erc20's.
        _amount = _receiveValue(msg.sender, _amount);

        // Ensure the amount is at least the minimum required.
        _ensureMinimum(_amount);

        // We stage because this amount should not become available until the deposit is processed.
        _stageAmount(_amount);

        // If the contract can change liquidity immediately, add the liquidity.
        if (_canChangeLiquidity()) {
            _addLiquidity(msg.sender, _amount, _getAvailableBalance());
            _resetLiquidity();
        } else {
            // Otherwise, queue the liquidity change.
            _queueLiquidityChange(0, _amount);
        }
    }

    /// @notice Either withdraws, or queues a withdrawal of the given amount by the sender.
    /// @param _amount The amount to withdraw, must be greater than zero.
    function withdraw(uint256 _amount) external enforceMinimum(_amount) {
        // Ensure the user has enough shares to withdraw.
        if (_users[msg.sender].shares < _amount) revert InsufficientShares();

        // If the contract can change liquidity immediately, remove the liquidity.
        if (_canChangeLiquidity()) {
            _removeLiquidity(msg.sender, _amount, _getAvailableBalance());
            _resetLiquidity();
        } else {
            // Otherwise, queue the liquidity change.
            _queueLiquidityChange(1, _amount);
        }
    }

    // #######################################################################################

    function _getAvailableLiquidity() internal view returns (uint256) {
        return _availableLiquidity;
    }

    function _clearLiquidityQueue() internal {
        // Cache the available balance to avoid multiple calls to _getAvailableBalance.
        uint256 balance = _getAvailableBalance();
        uint256 length = _liquidityQueueLength;
        _liquidityQueueLength = 0;

        for (uint256 i = 0; i < length; ) {
            LiquidityDelta memory delta = _liquidityQueue[i];

            if (delta.action == 0) {
                _addLiquidity(delta.user, delta.amount, balance);
                unchecked {
                    balance += delta.amount;
                }
            } else {
                balance -= _removeLiquidity(delta.user, delta.amount, balance);
            }

            unchecked {
                i++;
            }
        }

        _resetLiquidity();

        uint64 nonce = _liquidityQueueNonce;
        unchecked {
            _liquidityQueueNonce = nonce + 1;
        }
        emit LiquidityQueueCleared(nonce);
    }

    function _useRoundLiquidity(uint256 _amount) internal {
        uint256 availableLiquidity = _availableLiquidity;
        if (_amount > availableLiquidity) {
            revert InsufficientLiquidity();
        }

        unchecked {
            availableLiquidity -= _amount;
        }

        _availableLiquidity = availableLiquidity;

        if (availableLiquidity < _lowLiquidityThreshold) {
            _onLowLiquidity();
        }
    }

    function _releaseRoundLiquidity(uint256 _amount) internal {
        unchecked {
            _availableLiquidity += _amount;
        }
    }

    // #######################################################################################

    function _canChangeLiquidity() internal view virtual returns (bool);

    function _onLowLiquidity() internal virtual {
        // This function can be overridden by the parent contract to handle low liquidity situations.
        // For example, it could start the game early.
    }

    // #######################################################################################

    function _setMaxExposure(uint64 _numerator) private {
        if (_numerator < 100 || _numerator > 5000) {
            revert InvalidValue(_numerator);
        }

        _maxExposureNumerator = _numerator;
        emit MaxExposureUpdated(_numerator);
    }

    function _setLowLiquidityThreshold(uint256 _value) private {
        _lowLiquidityThreshold = _value;
        emit LowLiquidityThresholdUpdated(_value);
    }

    function _queueLiquidityChange(uint8 _action, uint256 _amount) private {
        uint64 nonce = _liquidityQueueNonce;
        if (_users[msg.sender].queueNonce == nonce) revert OneChangePerRound();
        _users[msg.sender].queueNonce = nonce;

        uint64 length = _liquidityQueueLength;
        if (length == _MAX_LIQUIDITY_QUEUE_SIZE) revert LiquidityQueueFull();

        _liquidityQueue[length] = LiquidityDelta(_action, msg.sender, _amount);
        unchecked {
            _liquidityQueueLength = length + 1;
        }

        emit LiquidityChangeQueued(nonce, msg.sender, _action, _amount);
    }

    function _addLiquidity(address _user, uint256 _amount, uint256 _balance) private {
        uint256 newShares = _totalShares == 0 ? _amount : (_amount * _totalShares) / _balance;

        unchecked {
            _users[_user].shares += uint192(newShares);
            _totalShares += newShares;
        }

        // The liquidity has been processed, so we can make the amount available.
        _unstageAmount(_amount);

        emit LiquidityAdded(_user, _amount, newShares);
    }

    function _removeLiquidity(address _user, uint256 _amount, uint256 _balance) private returns (uint256) {
        uint256 withdrawAmount = (_amount * _balance) / _totalShares;
        unchecked {
            _users[_user].shares -= uint192(_amount);
            _totalShares -= _amount;
        }

        _sendValue(_user, withdrawAmount);

        emit LiquidityRemoved(_user, withdrawAmount, _amount);

        return withdrawAmount;
    }

    function _resetLiquidity() private {
        // The available liquidity is recalculated based on the current balance and the maximum exposure.
        _availableLiquidity = (_getAvailableBalance() * _maxExposureNumerator) / _DENOMINATOR;
    }
}
