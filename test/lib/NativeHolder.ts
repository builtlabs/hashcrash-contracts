import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

const oneEther = ethers.parseEther("1");

describe.only("NativeHolder", function () {
    async function fixture() {
        const [deployer, user, recipient, bank] = await ethers.getSigners();

        const WETHMock = await ethers.getContractFactory("WETH9");
        const weth = await WETHMock.deploy();
        await weth.waitForDeployment();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const token = await MockERC20.deploy();
        await token.waitForDeployment();

        const NativeHolderHarness = await ethers.getContractFactory("NativeHolderHarness");
        const sut = await NativeHolderHarness.deploy(await weth.getAddress());
        await sut.waitForDeployment();

        return {
            sut,
            weth,
            token,
            wallets: {
                deployer,
                user,
                recipient,
                bank,
            },
        };
    }

    describe("constructor", function () {
        it("Should set the weth address", async function () {
            const { sut, weth } = await loadFixture(fixture);

            expect(await sut.getWeth()).to.equal(weth.target);
        });
    });

    describe("getWeth", function () {
        it("Should get the weth address", async function () {
            const { sut, weth } = await loadFixture(fixture);

            expect(await sut.getWeth()).to.equal(weth.target);
        });
    });

    describe("_receiveEther", function () {
        it("Should revert when sending ether but not WETH", async function () {
            const { sut, weth, token } = await loadFixture(fixture);

            await weth.deposit({ value: oneEther });
            await weth.approve(sut.target, oneEther);

            await expect(sut.receiveEther(token.target, { value: oneEther }))
                .to.be.revertedWithCustomError(sut, "TokenDoesNotWrap")
                .withArgs(token.target);
        });

        it("Should do nothing if the amount is zero", async function () {
            const { sut, weth } = await loadFixture(fixture);

            await sut.receiveEther(weth.target, { value: 0n });

            expect(await weth.balanceOf(sut.target)).to.equal(0n);
        });

        it("Should wrap the sent eth", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            await sut.receiveEther(weth.target, { value: oneEther });

            expect(await weth.balanceOf(sut.target)).to.equal(oneEther);
        });

        it("Should return the eth amount only", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            await expect(sut.receiveEther(weth.target, { value: oneEther }))
                .to.emit(sut, "ReceiveReturn")
                .withArgs(oneEther);

            expect(await weth.balanceOf(sut.target)).to.equal(oneEther);
            expect(await weth.balanceOf(wallets.deployer.address)).to.equal(0n);
        });
    });

    describe("_sendEther", function () {
        it("Should revert if the contract has insufficient funds", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.sendEther(wallets.recipient.address, oneEther)).to.be.revertedWithCustomError(
                sut,
                "FailedToTransferEther"
            );
        });

        it("Should do nothing if the amount is zero", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const recipientBalanceBefore = await ethers.provider.getBalance(wallets.recipient.address);

            await sut.sendEther(wallets.recipient.address, 0n);

            const recipientBalanceAfter = await ethers.provider.getBalance(wallets.recipient.address);

            expect(recipientBalanceAfter).to.equal(recipientBalanceBefore);
        });

        it("Should send the ether to the recipient", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await wallets.bank.sendTransaction({ to: sut.target, value: oneEther });

            const recipientBalanceBefore = await ethers.provider.getBalance(wallets.recipient.address);
            const sutBalanceBefore = await ethers.provider.getBalance(sut.target);

            await sut.sendEther(wallets.recipient.address, oneEther);

            const recipientBalanceAfter = await ethers.provider.getBalance(wallets.recipient.address);
            const sutBalanceAfter = await ethers.provider.getBalance(sut.target);

            expect(sutBalanceAfter).to.equal(sutBalanceBefore - oneEther);
            expect(recipientBalanceAfter).to.equal(recipientBalanceBefore + oneEther);
        });
    });

    describe("_unwrapWETH", function () {
        it("Should revert when there is insufficient WETH", async function () {
            const { sut } = await loadFixture(fixture);

            await expect(sut.unwrapWETH(oneEther)).to.be.reverted;
        });

        it("Should do nothing when the amount is zero", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            await sut.connect(wallets.bank).receiveEther(weth.target, { value: oneEther });

            const ethBalanceBefore = await ethers.provider.getBalance(sut.target);
            const wethBalanceBefore = await weth.balanceOf(sut.target);

            await sut.unwrapWETH(0n);

            const ethBalanceAfter = await ethers.provider.getBalance(sut.target);
            const wethBalanceAfter = await weth.balanceOf(sut.target);

            expect(ethBalanceAfter).to.equal(ethBalanceBefore);
            expect(wethBalanceAfter).to.equal(wethBalanceBefore);
        });

        it("Should unwrap the WETH", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            await sut.connect(wallets.bank).receiveEther(weth.target, { value: oneEther });

            const ethBalanceBefore = await ethers.provider.getBalance(sut.target);
            const wethBalanceBefore = await weth.balanceOf(sut.target);

            await sut.unwrapWETH(oneEther);

            const ethBalanceAfter = await ethers.provider.getBalance(sut.target);
            const wethBalanceAfter = await weth.balanceOf(sut.target);

            expect(ethBalanceAfter).to.equal(ethBalanceBefore + oneEther);
            expect(wethBalanceAfter).to.equal(wethBalanceBefore - oneEther);
        });
    });

    describe("_isWETH", function () {
        it("Should return true for WETH", async function () {
            const { sut, weth } = await loadFixture(fixture);

            expect(await sut.isWETH(weth.target)).to.equal(true);
        });

        it("Should return false for non-WETH", async function () {
            const { sut, token } = await loadFixture(fixture);

            expect(await sut.isWETH(token.target)).to.equal(false);
        });
    });
});
