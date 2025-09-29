import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

const oneEther = ethers.parseEther("1");

// TODO: Approval tests

describe.only("ERC20Holder", function () {
    async function fixture() {
        const [deployer, user, recipient] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const token = await MockERC20.deploy();
        await token.waitForDeployment();

        const TokenReceiverHarness = await ethers.getContractFactory("ERC20HolderHarness");
        const sut = await TokenReceiverHarness.deploy();
        await sut.waitForDeployment();

        return {
            sut,
            token,
            wallets: {
                deployer,
                user,
                recipient,
            },
        };
    }

    describe("_approveToken", function () {
        it("Should set the token approval", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await sut.approveToken(token.target, wallets.recipient.address, oneEther);

            expect(await token.allowance(sut.target, wallets.recipient.address)).to.equal(oneEther);
        });
    });

    describe("_receiveToken", function () {
        it("Should revert if transferFrom returns false", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.deployer.address, oneEther);
            await token.approve(sut.target, oneEther);

            await token.mockReturn();

            await expect(sut.receiveToken(token.target, oneEther))
                .to.be.revertedWithCustomError(sut, "SafeERC20FailedOperation")
                .withArgs(token.target);
        });

        it("Should revert if the sender has not approved", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.deployer.address, oneEther);

            await expect(sut.receiveToken(token.target, oneEther))
                .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
                .withArgs(sut.target, 0, oneEther);
        });

        it("Should revert if the sender has insufficient funds", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.approve(sut.target, oneEther);

            await expect(sut.receiveToken(token.target, oneEther))
                .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
                .withArgs(wallets.deployer.address, 0, oneEther);
        });

        it("Should do nothing if the amount is zero", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.deployer.address, oneEther);
            await token.approve(sut.target, oneEther);

            const sutBalanceBefore = await token.balanceOf(sut.target);
            const deployerBalanceBefore = await token.balanceOf(wallets.deployer.address);

            await sut.receiveToken(token.target, 0n);

            const sutBalanceAfter = await token.balanceOf(sut.target);
            const deployerBalanceAfter = await token.balanceOf(wallets.deployer.address);

            expect(sutBalanceAfter).to.equal(sutBalanceBefore);
            expect(deployerBalanceAfter).to.equal(deployerBalanceBefore);
        });

        it("Should receive the token amount", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.deployer.address, oneEther);
            await token.approve(sut.target, oneEther);

            const sutBalanceBefore = await token.balanceOf(sut.target);
            const deployerBalanceBefore = await token.balanceOf(wallets.deployer.address);

            await sut.receiveToken(token.target, oneEther);

            const sutBalanceAfter = await token.balanceOf(sut.target);
            const deployerBalanceAfter = await token.balanceOf(wallets.deployer.address);

            expect(sutBalanceAfter).to.equal(sutBalanceBefore + oneEther);
            expect(deployerBalanceAfter).to.equal(deployerBalanceBefore - oneEther);
        });

        it("Should return the token amount", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.deployer.address, oneEther);
            await token.approve(sut.target, oneEther);

            await expect(sut.receiveToken(token.target, oneEther)).to.emit(sut, "ReceiveReturn").withArgs(oneEther);
        });
    });

    describe("_sendToken", function () {
        it("Should revert if transfer returns false", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(sut.target, oneEther);

            await token.mockReturn();

            await expect(sut.sendToken(token.target, wallets.deployer.address, oneEther))
                .to.be.revertedWithCustomError(sut, "SafeERC20FailedOperation")
                .withArgs(token.target);
        });

        it("Should revert if the contract has insufficient funds", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await expect(sut.sendToken(token.target, wallets.deployer.address, oneEther))
                .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
                .withArgs(sut.target, 0, oneEther);
        });

        it("Should do nothing if the amount is zero", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await sut.sendToken(token.target, wallets.recipient.address, 0n);

            expect(await token.balanceOf(wallets.recipient.address)).to.equal(0n);
            expect(await token.balanceOf(sut.target)).to.equal(0n);
        });

        it("Should send the token to the recipient", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(sut.target, oneEther);

            await sut.sendToken(token.target, wallets.recipient.address, oneEther);

            expect(await token.balanceOf(wallets.recipient.address)).to.equal(oneEther);
            expect(await token.balanceOf(sut.target)).to.equal(0n);
        });
    });

    describe("_tokenBalance", function () {
        it("Should return the token balance", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            expect(await sut.tokenBalance(token.target)).to.equal(0n);

            await token.mint(sut.target, oneEther);

            expect(await sut.tokenBalance(token.target)).to.equal(oneEther);
        });
    });
});
