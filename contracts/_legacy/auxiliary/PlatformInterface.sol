// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { WrappedContext } from "../currency/WrappedContext.sol";

/// @title PlatformInterface
/// @author BuiltByFrancis
/// @notice A generic contract used for fee collection, referral, and reward distribution.
contract PlatformInterface is WrappedContext, Ownable {
    uint256 private constant DENOMINATOR = 10000;

    // #######################################################################################

    error AlreadyReferred();
    error SeasonNotStarted();

    error InvalidValue(uint256 value);
    error InvalidAddress(address addr);

    event PlatformSet(address indexed platform);
    event SeasonStarted(uint64 indexed season, address[] gamemodes);
    event SeasonEnded(uint64 indexed season);

    event Referral(address indexed user, address indexed referrer);
    event ReferralRewardSet(uint256 indexed index, uint256 numerator);

    event RewardEarned(address indexed user, address indexed token, uint256 amount);
    event RewardClaimed(address indexed user, address indexed token, uint256 amount);

    // #######################################################################################

    address private _platform;
    uint48 private _startCounter;
    uint48 private _endCounter;

    mapping(address => address) private _referredBy;
    mapping(uint256 => uint256) private _referralReward;

    mapping(address => mapping(address => uint256)) private _tokenUserRewards;

    // #######################################################################################

    /// @notice Constructor.
    /// @param platform_ The platform wallet for fee collection.
    /// @param owner_ The initial owner of the contract.
    constructor(address platform_, address weth_, address owner_) WrappedContext(weth_) Ownable(owner_) {
        _setPlatform(platform_);

        _setReferralReward(0, 1500); // 15%
        _setReferralReward(1, 500); // 5%
    }

    // #######################################################################################

    /// @notice Returns the next season number.
    function getNextSeason() external view returns (uint48) {
        return _startCounter;
    }

    /// @notice Returns the current platform address.
    function getPlatform() external view returns (address) {
        return _platform;
    }

    /// @notice Returns the referrer of a user, address(0) is returned if they do not have one.
    function getReferredBy(address _user) external view returns (address) {
        return _referredBy[_user];
    }

    /// @notice Returns the referral reward numerator for a given index.
    function getReferralReward(uint256 _index) external view returns (uint256) {
        return _referralReward[_index];
    }

    /// @notice Returns the reward for a user in a specific token.
    function getReward(address _token, address _user) external view returns (uint256) {
        return _tokenUserRewards[_token][_user];
    }

    /// @notice Returns the rewards for a list of tokens for a specific user.
    function getRewards(address[] calldata tokens, address _user) external view returns (uint256[] memory) {
        uint256[] memory rewards = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            rewards[i] = _tokenUserRewards[tokens[i]][_user];
        }
        return rewards;
    }

    // #######################################################################################

    /// @notice Starts a new season.
    /// @param gamemodes_ The list of gamemodes for the new season.
    function startSeason(address[] calldata gamemodes_) external onlyOwner {
        uint48 start = _startCounter;
        uint48 end = _endCounter;

        if (start != end) {
            emit SeasonEnded(end);

            unchecked {
                _endCounter = end + 1;
            }
        }

        emit SeasonStarted(start, gamemodes_);

        unchecked {
            _startCounter = start + 1;
        }
    }

    /// @notice Ends the current season.
    function endSeason() external onlyOwner {
        uint48 end = _endCounter;
        emit SeasonEnded(end);

        unchecked {
            end++;
        }

        if (_startCounter != end) revert SeasonNotStarted();

        _endCounter = end;
    }

    /// @notice Sets the platform address.
    /// @param platform_ The new platform address.
    function setPlatform(address platform_) external onlyOwner {
        _setPlatform(platform_);
    }

    /// @notice Sets the referral reward numerator for a given index.
    /// @param _index The index of the referral reward.
    /// @param _numerator The numerator for the referral reward.
    /// @dev the total referral reward rate must not exceed 100%, gaps are not allowed when adding new rewards, only when removing them (effectively removing everything after).
    function setReferralReward(uint256 _index, uint256 _numerator) external onlyOwner {
        _setReferralReward(_index, _numerator);
    }

    // #######################################################################################

    /// @notice Sets the referrer for the caller. The referrer must not be the caller, must not be address(0), and must not create a cycle.
    /// @param _referrer The address of the referrer.
    /// @dev This function can only be called once per user. If the user already has a referrer, it will revert.
    function setReferredBy(address _referrer) external {
        if (_referredBy[msg.sender] != address(0)) revert AlreadyReferred();

        if (_referrer == address(0) || _referrer == msg.sender || _isCyclical(_referrer))
            revert InvalidAddress(_referrer);

        _referredBy[msg.sender] = _referrer;
        emit Referral(msg.sender, _referrer);
    }

    /// @notice Claims rewards for the caller in a list of tokens.
    /// @param _tokens The list of token addresses for which to claim rewards.
    function claimRewards(address[] calldata _tokens) external {
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            uint256 reward = _tokenUserRewards[token][msg.sender];

            if (reward > 0) {
                _tokenUserRewards[token][msg.sender] = 0;

                SafeERC20.safeTransfer(IERC20(token), msg.sender, reward);

                emit RewardClaimed(msg.sender, token, reward);
            }
        }
    }

    // #######################################################################################

    /// @notice Receives tokens from the caller and sets up the rewards.
    /// @param _token The address of the token to receive.
    /// @param _value The amount of tokens to receive. Must be non-zero.
    /// @dev If the token is WETH, it will convert the native currency to WETH.
    function receiveFee(address _token, uint256 _value) external payable {
        uint256 _total = msg.value + _value;
        if (_total == 0) revert InvalidValue(_total);

        if (msg.value > 0) {
            if (_token != _getWETH()) revert InvalidAddress(_token);
            _nativeToWrapped();
        }

        if (_value > 0) {
            SafeERC20.safeTransferFrom(IERC20(_token), msg.sender, address(this), _value);
        }

        _setupRewards(_token, _total);
    }

    // #######################################################################################

    function _setPlatform(address platform_) private {
        if (platform_ == address(0)) revert InvalidAddress(platform_);
        _platform = platform_;
        emit PlatformSet(_platform);
    }

    function _setReferralReward(uint256 _index, uint256 _numerator) private {
        _referralReward[_index] = _numerator;

        _ensureNoGaps(_index);
        _ensureAggregateRewardRate();

        emit ReferralRewardSet(_index, _numerator);
    }

    function _setupRewards(address _token, uint256 _value) private {
        // Find the number of referrers (depth) for the caller.
        uint256 depth = _getDepth();

        // Find the referrers and their corresponding numerators.
        address[] memory referrers = _getReferrers(depth);
        uint256[] memory numerators = _getNumerators(depth);

        // Assign rewards to the referrers.
        uint256 remainder = _value;
        for (uint256 i = 0; i < depth; i++) {
            uint256 reward = (_value * numerators[i]) / DENOMINATOR;

            remainder -= reward;

            _tokenUserRewards[_token][referrers[i]] += reward;
            emit RewardEarned(referrers[i], _token, reward);
        }

        // Assign the remaining value to the platform.
        if (remainder > 0) {
            _tokenUserRewards[_token][_platform] += remainder;
            emit RewardEarned(_platform, _token, remainder);
        }
    }

    function _getDepth() private view returns (uint256) {
        uint256 depth = 0;

        address referrer = _referredBy[msg.sender];
        // Count how many referrers there are until we reach address(0) or a referrer with no reward.
        while (referrer != address(0) && _referralReward[depth] > 0) {
            referrer = _referredBy[referrer];
            unchecked {
                depth++;
            }
        }

        return depth;
    }

    function _getNumerators(uint256 _depth) private view returns (uint256[] memory) {
        uint256[] memory numerators = new uint256[](_depth);

        for (uint256 i = 0; i < _depth; i++) {
            numerators[i] = _referralReward[i];
        }

        return numerators;
    }

    function _getReferrers(uint256 _depth) private view returns (address[] memory) {
        address[] memory receivers = new address[](_depth);

        address referrer = _referredBy[msg.sender];
        for (uint256 i = 0; i < _depth; i++) {
            receivers[i] = referrer;
            referrer = _referredBy[referrer];
        }

        return receivers;
    }

    function _isCyclical(address _referrer) private view returns (bool) {
        address current = _referrer;
        while (current != address(0)) {
            if (current == msg.sender) {
                return true;
            }
            current = _referredBy[current];
        }
        return false;
    }

    function _ensureNoGaps(uint256 _index) private view {
        for (uint256 i = 0; i < _index; i++) {
            if (_referralReward[i] == 0) {
                revert InvalidValue(_index);
            }
        }
    }

    function _ensureAggregateRewardRate() private view {
        uint256 totalRate = 0;
        uint256 index = 0;
        uint256 currentRate = _referralReward[index];

        while (currentRate > 0) {
            unchecked {
                totalRate += currentRate;
                index++;
            }

            if (totalRate > DENOMINATOR) {
                revert InvalidValue(totalRate);
            }

            currentRate = _referralReward[index];
        }
    }
}
