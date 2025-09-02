// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { BPS } from "../lib/BPS.sol";
import { TokenReceiver } from "../lib/TokenReceiver.sol";

import { IWETH } from "../interfaces/IWETH.sol";
import { ILiquidityPool } from "../interfaces/ILiquidityPool.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { IPaymasterFlow } from "@matterlabs/zksync-contracts/contracts/l2-contracts/interfaces/IPaymasterFlow.sol";
import { IPaymaster, ExecutionResult, PAYMASTER_VALIDATION_SUCCESS_MAGIC } from "@matterlabs/zksync-contracts/contracts/l2-contracts/interfaces/IPaymaster.sol";
import { BOOTLOADER_ADDRESS, Transaction } from "@matterlabs/zksync-contracts/contracts/l2-contracts/L2ContractHelper.sol";

contract CrossAppLiquidity is Ownable, TokenReceiver, IPaymaster, ILiquidityPool {
    uint256 private constant _EXCHANGE_RATE_DENOMINATOR = 1e16;

    address immutable _REWARD_FUND;
    address immutable _GAS_FUND;
    address immutable _ORACLE;

    // #######################################################################################

    error NotOracle();
    error NotBootloader();
    error InvalidPaymasterInput();
    error FailedToTransferEther();

    error AppNotEnabled(address app);
    error TokenNotEnabled(address token);

    error HoldNotFound();
    error LengthMismatch();
    error InsufficientShares();
    error MaxExposureExceeded();
    error InsufficientLiquidity();
    error InsufficientShareValue();

    event AccessLevelUpdated(address indexed app, uint256 level);
    event TokenSettingsUpdated(address indexed token, TokenSettings settings);

    event LiquidityAdded(address indexed user, address indexed token, uint256 amount, uint256 shares);
    event LiquidityRemoved(address indexed user, address indexed token, uint256 tokenDelta, uint256 shareDelta);

    event LiquidityHoldPlaced(address indexed app, address indexed token, uint256 amount, uint256 requestId);
    event LiquidityHoldResolved(
        address indexed app,
        address indexed token,
        uint256 requestId,
        uint256 incoming,
        uint256 outgoing,
        uint256 fee
    );

    event ExchangeRateUpdated(address indexed token, uint256 rate);

    event GasFunded(uint256 amount);
    event GasSponsored(address indexed app, address indexed sender, uint256 amount);
    event GasLiquiditySponsored(address indexed app, address indexed sender, address token, uint256 amount);

    // #######################################################################################

    struct Token {
        uint256 onHold;
        uint256 totalShares;
        uint256 nextRequestId;
        mapping(uint256 => uint256) requests;
        mapping(address => uint256) userShares;
    }

    struct TokenSettings {
        bool enabled;
        uint32 feeBps;
        uint32 bufferBps;
        uint32 maxExposureBps;
        uint256 minShareValue;
    }

    struct UpdateTokenSettings {
        address token;
        TokenSettings settings;
    }

    struct AddressValue {
        address addr;
        uint256 value;
    }

    // #######################################################################################

    mapping(address => uint256) private _accessLevel;

    mapping(address => uint256) private _exchangeRateNumerator;

    mapping(address => Token) private _tokens;
    mapping(address => TokenSettings) private _tokenSettings;

    // #######################################################################################

    modifier onlyApp() {
        if (_accessLevel[msg.sender] < 2) revert AppNotEnabled(msg.sender);
        _;
    }

    modifier onlyOracle() {
        if (msg.sender != _ORACLE) revert NotOracle();
        _;
    }

    modifier onlyBootloader() {
        if (msg.sender != BOOTLOADER_ADDRESS) revert NotBootloader();
        _;
    }

    modifier onlyToken(address token_) {
        if (!_tokenSettings[token_].enabled) revert TokenNotEnabled(token_);
        _;
    }

    // #######################################################################################

    constructor(
        address owner_,
        address weth_,
        address oracle_,
        address gasFund_,
        address rewardFund_
    ) Ownable(owner_) TokenReceiver(weth_) {
        _ORACLE = oracle_;
        _GAS_FUND = gasFund_;
        _REWARD_FUND = rewardFund_;

        _setAccessLevel(address(this), 1);
    }

    // #######################################################################################

    // TODO: View functions, thinking some kind of provide token + user?, get all useful information.

    function getAccessLevel(address app_) external view returns (uint256) {
        return _accessLevel[app_];
    }

    function getTotalShares(address token_) external view returns (uint256) {
        return _tokens[token_].totalShares;
    }

    function getTotalBalance(address token_) external view returns (uint256) {
        return _getBalance(token_);
    }

    function getAvailableBalance(address token_) external view returns (uint256) {
        return _getAvailableBalance(token_);
    }

    function getUserShares(address token_, address user_) external view returns (uint256) {
        return _tokens[token_].userShares[user_];
    }

    function getUserShareValue(address token_, address user_) external view returns (uint256) {
        return _shareValue(_tokens[token_].userShares[user_], _getBalance(token_), _tokens[token_].totalShares);
    }

    function getMaxExposure(address token_) external view returns (uint256) {
        return BPS.calculate(_getBalance(token_), _tokenSettings[token_].maxExposureBps);
    }

    function getExchangeRate(address token_) external view returns (uint256) {
        return _exchangeRateNumerator[token_];
    }

    function getTokenSettings(address token_) external view returns (TokenSettings memory) {
        return _tokenSettings[token_];
    }

    function getMultipleTokenSettings(address[] calldata tokens_) external view returns (TokenSettings[] memory) {
        TokenSettings[] memory settings = new TokenSettings[](tokens_.length);
        for (uint256 i = 0; i < tokens_.length; ) {
            settings[i] = _tokenSettings[tokens_[i]];
            unchecked {
                ++i;
            }
        }
        return settings;
    }

    // #######################################################################################

    function setAccessLevel(address app_, uint256 level_) external onlyOwner {
        _setAccessLevel(app_, level_);
    }

    function setAccessLevels(AddressValue[] calldata accessLevel_) external onlyOwner {
        for (uint256 i = 0; i < accessLevel_.length; ) {
            _setAccessLevel(accessLevel_[i].addr, accessLevel_[i].value);
            unchecked {
                ++i;
            }
        }
    }

    function setTokenSettings(address token_, TokenSettings calldata settings_) external onlyOwner {
        _setTokenSettings(token_, settings_);
    }

    function setMultipleTokenSettings(UpdateTokenSettings[] calldata updates_) external onlyOwner {
        for (uint256 i = 0; i < updates_.length; ) {
            _setTokenSettings(updates_[i].token, updates_[i].settings);
            unchecked {
                ++i;
            }
        }
    }

    function setExchangeRate(address token_, uint256 rate_) external onlyOracle {
        _setExchangeRate(token_, rate_);
    }

    function setMultipleExchangeRates(AddressValue[] calldata rates_) external onlyOracle {
        for (uint256 i = 0; i < rates_.length; ) {
            _setExchangeRate(rates_[i].addr, rates_[i].value);
            unchecked {
                ++i;
            }
        }
    }

    function withdrawGas(uint256 _amount) external onlyOwner {
        _sendEther(payable(_GAS_FUND), _amount);
    }

    function withdrawAllGas() external onlyOwner {
        _sendEther(payable(_GAS_FUND), address(this).balance);
    }

    // #######################################################################################

    function deposit(address token_, uint256 amount_) external payable onlyToken(token_) {
        // Wrap any native ether, standardize behavior between weth and other erc20's.
        amount_ = _receiveValue(token_, amount_);

        // Get current balance and user shares
        uint256 currentBalance = _getBalance(token_);
        uint256 totalShares = _tokens[token_].totalShares;
        uint256 userShares = _tokens[token_].userShares[msg.sender];

        // Calculate new shares to mint
        unchecked {
            uint256 newShares = totalShares == 0 ? amount_ : (amount_ * totalShares) / (currentBalance - amount_);
            totalShares += newShares;
            userShares += newShares;
        }

        // Ensure sufficient share value
        if (_shareValue(userShares, currentBalance, totalShares) < _tokenSettings[token_].minShareValue) {
            revert InsufficientShareValue();
        }

        // Commit changes
        _tokens[token_].totalShares = totalShares;
        _tokens[token_].userShares[msg.sender] = userShares;

        emit LiquidityAdded(msg.sender, token_, amount_, totalShares);
    }

    function withdraw(address token_, uint256 shareAmount_) external {
        // Cache current state
        uint256 currentBalance = _getBalance(token_);
        uint256 totalShares = _tokens[token_].totalShares;
        uint256 userShares = _tokens[token_].userShares[msg.sender];

        // Ensure user has enough shares
        if (userShares < shareAmount_) revert InsufficientShares();

        // Offset current state by withdrawn amounts
        uint256 withdrawAmount = _shareValue(shareAmount_, currentBalance, totalShares);

        unchecked {
            userShares -= shareAmount_;
            totalShares -= shareAmount_;
            currentBalance -= withdrawAmount;
        }

        // Ensure sufficient share value after withdrawal
        if (
            userShares > 0 &&
            _shareValue(userShares, currentBalance, totalShares) < _tokenSettings[token_].minShareValue
        ) {
            revert InsufficientShareValue();
        }

        // Commit changes
        _tokens[token_].userShares[msg.sender] = userShares;
        _tokens[token_].totalShares = totalShares;

        _sendValue(token_, msg.sender, withdrawAmount);

        emit LiquidityRemoved(msg.sender, token_, withdrawAmount, totalShares);
    }

    function requestLiquidity(
        address token_,
        uint256 amount_
    ) external onlyApp onlyToken(token_) returns (uint256 requestId, uint256 amount) {
        uint256 availableBalance = _getAvailableBalance(token_);
        uint256 onHold = _tokens[token_].onHold;
        uint256 totalBalance = availableBalance + onHold;

        // Ensure amount is within limits
        uint256 limit = BPS.calculate(totalBalance, _tokenSettings[token_].maxExposureBps);
        if (amount_ == 0) {
            amount_ = limit;
        } else if (amount_ > limit) {
            revert MaxExposureExceeded();
        }

        limit = BPS.calculate(totalBalance, _tokenSettings[token_].bufferBps);
        if (availableBalance < amount_ || availableBalance - amount_ < limit) {
            revert InsufficientLiquidity();
        }

        // Place hold
        uint256 nextRequestId = _tokens[token_].nextRequestId;

        _tokens[token_].requests[nextRequestId] = amount_;
        unchecked {
            _tokens[token_].onHold = onHold + amount_;
            _tokens[token_].nextRequestId = nextRequestId + 1;
        }

        _sendValue(token_, msg.sender, amount_);

        emit LiquidityHoldPlaced(msg.sender, token_, amount_, nextRequestId);

        return (nextRequestId, amount_);
    }

    function settleLiquidityRequest(
        uint256 requestId_,
        address token_,
        uint256 incoming_,
        uint256 outgoing_
    ) external onlyApp onlyToken(token_) {
        uint256 hold = _tokens[token_].requests[requestId_];
        delete _tokens[token_].requests[requestId_];

        if (hold == 0) revert HoldNotFound();

        uint256 fee = 0;
        if (incoming_ > 0) {
            fee = BPS.calculate(incoming_, _tokenSettings[token_].feeBps);
            _sendValue(token_, _GAS_FUND, fee);
        }

        unchecked {
            _tokens[token_].onHold -= hold;
        }

        emit LiquidityHoldResolved(msg.sender, token_, requestId_, incoming_, outgoing_, fee);
    }

    // #######################################################################################

    /// @inheritdoc IPaymaster
    function validateAndPayForPaymasterTransaction(
        bytes32, // _txHash
        bytes32, // _suggestedSignedHash
        Transaction calldata _transaction
    ) external payable onlyBootloader returns (bytes4 magic, bytes memory context) {
        magic = PAYMASTER_VALIDATION_SUCCESS_MAGIC;
        context = new bytes(0);

        if (
            _transaction.paymasterInput.length < 4 ||
            bytes4(_transaction.paymasterInput[0:4]) != IPaymasterFlow.general.selector
        ) {
            revert InvalidPaymasterInput();
        }

        if (_accessLevel[_toAddress(_transaction.to)] > 0 && _transaction.paymasterInput.length > 4) {
            context = _transaction.paymasterInput[4:];
        }

        _sendEther(payable(BOOTLOADER_ADDRESS), _transaction.gasLimit * _transaction.maxFeePerGas);
    }

    /// @inheritdoc IPaymaster
    function postTransaction(
        bytes calldata _context,
        Transaction calldata _transaction,
        bytes32, // _txHash
        bytes32, // _suggestedSignedHash
        ExecutionResult, // _txResult
        uint256 _maxRefundedGas
    ) external payable onlyBootloader {
        address app = _toAddress(_transaction.to);
        address sender = _toAddress(_transaction.from);

        uint256 minWeiSpent = (_transaction.gasLimit - _maxRefundedGas) * _transaction.maxFeePerGas;
        emit GasSponsored(app, sender, minWeiSpent);

        if (_context.length > 0) {
            address token = abi.decode(_context, (address));
            address weth = _wethAddress();

            if (token == weth) {
                IWETH(weth).withdraw(minWeiSpent);
                emit GasLiquiditySponsored(app, sender, token, minWeiSpent);
            } else {
                uint256 exchangeRateNumerator = _exchangeRateNumerator[token];

                if (exchangeRateNumerator > 0) {
                    uint256 minTokenSpent = (minWeiSpent * exchangeRateNumerator) / _EXCHANGE_RATE_DENOMINATOR;
                    _sendValue(token, _GAS_FUND, minTokenSpent);
                    emit GasLiquiditySponsored(app, sender, token, minTokenSpent);
                }
            }
        }
    }

    // #######################################################################################

    receive() external payable {
        emit GasFunded(msg.value);
    }

    // #######################################################################################

    function _sendEther(address payable _to, uint256 _amount) private {
        (bool success, ) = _to.call{ value: _amount }("");
        if (!success) revert FailedToTransferEther();
    }

    function _setAccessLevel(address app_, uint256 level_) private {
        _accessLevel[app_] = level_;
        emit AccessLevelUpdated(app_, level_);
    }

    function _setExchangeRate(address token_, uint256 rate_) private {
        _exchangeRateNumerator[token_] = rate_;
        emit ExchangeRateUpdated(token_, rate_);
    }

    function _setTokenSettings(address token_, TokenSettings calldata settings_) private {
        _tokenSettings[token_] = settings_;
        emit TokenSettingsUpdated(token_, settings_);
    }

    function _getBalance(address token_) private view returns (uint256) {
        uint256 available = _getAvailableBalance(token_);
        unchecked {
            return available + _tokens[token_].onHold;
        }
    }

    function _getAvailableBalance(address token_) private view returns (uint256) {
        return IERC20(token_).balanceOf(address(this));
    }

    function _shareValue(uint256 userShares_, uint256 balance_, uint256 totalShares_) private pure returns (uint256) {
        if (totalShares_ == 0) return 0;
        unchecked {
            return (userShares_ * balance_) / totalShares_;
        }
    }

    function _toAddress(uint256 value_) private pure returns (address) {
        return address(uint160(value_));
    }
}
