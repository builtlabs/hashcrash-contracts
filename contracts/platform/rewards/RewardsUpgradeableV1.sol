// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20Holder } from "../../lib/ERC20Holder.sol";

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

abstract contract RewardsUpgradeableV1 is Initializable, ERC20Holder {
    error MissingRewardForToken(address token);

    event RewardEarned(address indexed user, address indexed token, uint256 amount);
    event RewardClaimed(address indexed user, address indexed token, uint256 amount);

    // #######################################################################################

    struct RewardsStorage {
        mapping(address => mapping(address => uint256)) rewards;
    }

    // keccak256("hashcrash.storage.RewardsUpgradeable")
    bytes32 private constant RewardsStorageLocation =
        0x43b319c8f74bd606627b47210043da116106cba1f4d51d5fba9951769184273d;

    function _getRewardsStorage() private pure returns (RewardsStorage storage $) {
        assembly {
            $.slot := RewardsStorageLocation
        }
    }

    // #######################################################################################

    /// @notice Returns the reward for a user in a specific token.
    function getReward(address _token, address _user) external view returns (uint256) {
        return _getRewardsStorage().rewards[_token][_user];
    }

    /// @notice Returns the rewards for a list of tokens for a specific user.
    function getRewards(address[] calldata tokens, address _user) external view returns (uint256[] memory) {
        RewardsStorage storage $ = _getRewardsStorage();

        uint256[] memory rewards = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ) {
            rewards[i] = $.rewards[tokens[i]][_user];

            unchecked {
                ++i;
            }
        }
        return rewards;
    }

    // #######################################################################################

    /// @notice Claims rewards for the caller in a list of tokens.
    /// @param _tokens The list of token addresses for which to claim rewards.
    function claimRewards(address[] calldata _tokens) external {
        RewardsStorage storage $ = _getRewardsStorage();

        for (uint256 i = 0; i < _tokens.length; ) {
            address token = _tokens[i];
            uint256 reward = $.rewards[token][msg.sender];

            if (reward == 0) revert MissingRewardForToken(token);

            $.rewards[token][msg.sender] = 0;
            _sendToken(token, msg.sender, reward);
            emit RewardClaimed(msg.sender, token, reward);

            unchecked {
                ++i;
            }
        }
    }

    // #######################################################################################

    function _allocateReward(address _token, address _user, uint256 _amount) internal {
        if (_amount == 0) return;

        unchecked {
            _getRewardsStorage().rewards[_token][_user] += _amount;
        }

        emit RewardEarned(_user, _token, _amount);
    }

    // #######################################################################################

    function _getReferralBPS(uint256 depth_, uint64 referralCount_) internal pure returns (uint256) {
        if (depth_ > 1 || referralCount_ == 0) return 0;
        return [[500, 1000, 1500, 2000, 2500], [200, 400, 600, 800, 1000]][depth_][_referralMultiplier(referralCount_)];
    }

    function _referralMultiplier(uint64 referralCount_) private pure returns (uint256) {
        if (referralCount_ < 10) return 0;
        if (referralCount_ < 50) return 1;
        if (referralCount_ < 100) return 2;
        if (referralCount_ < 250) return 3;
        return 4;
    }
}
