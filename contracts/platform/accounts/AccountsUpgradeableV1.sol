// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

abstract contract AccountsUpgradeableV1 is Initializable {
    error InvalidReferrer(address referrer_);
    error AccountAlreadyExists(address user_);

    event AccountCreated(address indexed user_, address indexed referrer_);

    // #######################################################################################

    struct Account {
        bool exists;
        address referredBy;
        uint64 referralCount;
    }

    struct AccountsStorage {
        mapping(address => Account) accounts;
    }

    // keccak256("hashcrash.storage.AccountsUpgradeable")
    bytes32 private constant AccountsStorageLocation =
        0xf85fd3503381f824991f02fe90380a0e6efd77de5807a2e0f9ae54c7081be371;

    function _getAccountsStorage() private pure returns (AccountsStorage storage $) {
        assembly {
            $.slot := AccountsStorageLocation
        }
    }

    // #######################################################################################

    function getAccount(address user_) external view returns (Account memory) {
        return _getAccount(user_);
    }

    function getAccountExists(address user_) external view returns (bool) {
        return _getAccountExists(user_);
    }

    function getReferredBy(address user_) external view returns (address) {
        return _getReferredBy(user_);
    }

    function getReferralCount(address user_) external view returns (uint64) {
        return _getReferralCount(user_);
    }

    // #######################################################################################

    function createAccount(address referrer_) external {
        _createAccount(referrer_);
    }

    // #######################################################################################

    function _getAccount(address user_) internal view returns (Account memory) {
        return _getAccountsStorage().accounts[user_];
    }

    function _getAccountExists(address user_) internal view returns (bool) {
        return _getAccount(user_).exists;
    }

    function _getReferredBy(address user_) internal view returns (address) {
        return _getAccount(user_).referredBy;
    }

    function _getReferralCount(address user_) internal view returns (uint64) {
        return _getAccount(user_).referralCount;
    }

    // #######################################################################################

    function _createAccount(address referrer_) internal {
        AccountsStorage storage $ = _getAccountsStorage();

        if ($.accounts[msg.sender].exists) revert AccountAlreadyExists(msg.sender);

        if (referrer_ != address(0)) {
            Account storage referrerAccount = $.accounts[referrer_];

            if (referrer_ == msg.sender || !referrerAccount.exists) revert InvalidReferrer(referrer_);

            unchecked {
                ++referrerAccount.referralCount;
            }
        }

        _uncheckedCreateAccount(Account(true, referrer_, 0));
    }

    function _uncheckedCreateAccount(Account memory account_) internal {
        _getAccountsStorage().accounts[msg.sender] = account_;
        emit AccountCreated(msg.sender, account_.referredBy);
    }
}
