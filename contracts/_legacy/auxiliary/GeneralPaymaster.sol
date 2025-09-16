// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IPaymasterFlow } from "@matterlabs/zksync-contracts/contracts/l2-contracts/interfaces/IPaymasterFlow.sol";
import { IPaymaster, ExecutionResult, PAYMASTER_VALIDATION_SUCCESS_MAGIC } from "@matterlabs/zksync-contracts/contracts/l2-contracts/interfaces/IPaymaster.sol";
import { BOOTLOADER_ADDRESS, Transaction } from "@matterlabs/zksync-contracts/contracts/l2-contracts/L2ContractHelper.sol";

/// @title GeneralPaymaster
/// @author BuiltByFrancis
/// @notice A general "allow all" paymaster implementing the ZK IPaymaster interface.
contract GeneralPaymaster is IPaymaster, Ownable {
    error NotBootloader();
    error InvalidPaymasterInput();
    error FailedToTransferEther();

    // #######################################################################################

    modifier onlyBootloader() {
        if (msg.sender != BOOTLOADER_ADDRESS) revert NotBootloader();
        _;
    }

    // #######################################################################################

    /// @notice Constructor initializes the contract with the given parameters.
    /// @param owner_ The owner of the contract.
    constructor(address owner_) Ownable(owner_) {}

    // #######################################################################################

    /// @notice Withdraws a specified amount of Ether from the contract to the owner's address.
    /// @param _amount The amount of Ether to withdraw.
    function withdraw(uint256 _amount) external onlyOwner {
        _sendEther(payable(owner()), _amount);
    }

    /// @notice Withdraws all Ether from the contract to the owner's address.
    function withdrawAll() external onlyOwner {
        _sendEther(payable(owner()), address(this).balance);
    }

    // #######################################################################################

    /// @inheritdoc IPaymaster
    function validateAndPayForPaymasterTransaction(
        bytes32, // _txHash
        bytes32, // _suggestedSignedHash
        Transaction calldata _transaction
    ) external payable onlyBootloader returns (bytes4 magic, bytes memory context) {
        magic = PAYMASTER_VALIDATION_SUCCESS_MAGIC;
        context = new bytes(0); // No context is needed for this paymaster.

        if (
            _transaction.paymasterInput.length < 4 ||
            bytes4(_transaction.paymasterInput[0:4]) != IPaymasterFlow.general.selector
        ) {
            revert InvalidPaymasterInput();
        }

        _sendEther(payable(BOOTLOADER_ADDRESS), _transaction.gasLimit * _transaction.maxFeePerGas);
    }

    /// @inheritdoc IPaymaster
    function postTransaction(
        bytes calldata _context,
        Transaction calldata _transaction,
        bytes32 _txHash,
        bytes32 _suggestedSignedHash,
        ExecutionResult _txResult,
        uint256 _maxRefundedGas
    ) external payable onlyBootloader {}

    // #######################################################################################

    receive() external payable {}

    // #######################################################################################

    function _sendEther(address payable _to, uint256 _amount) private {
        (bool success, ) = _to.call{ value: _amount }("");
        if (!success) revert FailedToTransferEther();
    }
}
