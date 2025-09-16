// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HashCrash } from "../HashCrash.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MaliciousLiquidityProvider {
    mapping(uint256 => UniqueAddressHack) public users;

    function multiDepositNative(HashCrash _game, uint256 _deposits, uint256 _startIndex) external payable {
        uint256 amount = _game.getMinimum();
        for (uint256 i = 0; i < _deposits; i++) {
            UniqueAddressHack hack = new UniqueAddressHack();
            hack.depositNative{ value: amount }(_game, amount);
            users[_startIndex + i] = hack;
        }
    }

    function multiDeposit(HashCrash _game, IERC20 _token, uint256 _deposits, uint256 _startIndex) external {
        uint256 amount = _game.getMinimum();
        for (uint256 i = 0; i < _deposits; i++) {
            UniqueAddressHack hack = new UniqueAddressHack();
            _token.transfer(address(hack), amount);
            hack.depositToken(_game, _token, amount);
            users[_startIndex + i] = hack;
        }
    }

    function multiWithdraw(HashCrash _game, uint256 _withdraws, uint256 _startIndex) external {
        uint256 amount = _game.getMinimum();
        for (uint256 i = 0; i < _withdraws; i++) {
            UniqueAddressHack hack = users[_startIndex + i];
            hack.withdraw(_game, amount);
        }
    }
}

contract UniqueAddressHack {
    function depositNative(HashCrash _game, uint256 _amount) external payable {
        _game.deposit{ value: msg.value }(_amount);
    }

    function depositToken(HashCrash _game, IERC20 _token, uint256 _amount) external {
        _token.approve(address(_game), _amount);
        _game.deposit(_amount);
    }

    function withdraw(HashCrash _game, uint256 _amount) external {
        _game.withdraw(_amount);
    }
}
