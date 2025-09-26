import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

const oneEther = ethers.parseEther("1");

describe("TokenReceiver", function () {
    async function fixture() {
        const [deployer, user, recipient] = await ethers.getSigners();

        const WETHMock = await ethers.getContractFactory("WETH9");
        const weth = await WETHMock.deploy();
        await weth.waitForDeployment();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const token = await MockERC20.deploy();
        await token.waitForDeployment();

        const TokenReceiverHarness = await ethers.getContractFactory("TokenReceiverHarness");
        const sut = await TokenReceiverHarness.deploy(await weth.getAddress());
        await sut.waitForDeployment();

        return {
            sut,
            weth,
            token,
            wallets: {
                deployer,
                user,
                recipient,
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

    describe("_receiveValue", function () {
        it("Should revert if transferFrom returns false", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.deployer.address, oneEther);
            await token.approve(sut.target, oneEther);

            await token.mockReturn();

            await expect(sut.receiveValue(token.target, oneEther))
                .to.be.revertedWithCustomError(sut, "SafeERC20FailedOperation")
                .withArgs(token.target);
        });

        it("Should revert if the sender has not approved", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.deployer.address, oneEther);

            await expect(sut.receiveValue(token.target, oneEther))
                .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
                .withArgs(sut.target, 0, oneEther);
        });

        it("Should revert if the sender has insufficient funds", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.approve(sut.target, oneEther);

            await expect(sut.receiveValue(token.target, oneEther))
                .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
                .withArgs(wallets.deployer.address, 0, oneEther);
        });

        it("Should revert when sending ether but not WETH", async function () {
            const { sut, weth, token } = await loadFixture(fixture);

            await weth.deposit({ value: oneEther });
            await weth.approve(sut.target, oneEther);

            await expect(sut.receiveValue(token.target, 0n, { value: oneEther }))
                .to.be.revertedWithCustomError(sut, "TokenDoesNotWrap")
                .withArgs(token.target);
        });

        it("Should wrap the sent eth", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            await sut.receiveValue(weth.target, 0n, { value: oneEther });

            expect(await weth.balanceOf(sut.target)).to.equal(oneEther);
            expect(await weth.balanceOf(wallets.deployer.address)).to.equal(0n);
        });

        it("Should return the token amount only", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.deployer.address, oneEther);
            await token.approve(sut.target, oneEther);

            await expect(sut.receiveValue(token.target, oneEther)).to.emit(sut, "ReceiveReturn").withArgs(oneEther);
        });

        it("Should return the eth amount only", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            await expect(sut.receiveValue(weth.target, 0n, { value: oneEther }))
                .to.emit(sut, "ReceiveReturn")
                .withArgs(oneEther);

            expect(await weth.balanceOf(sut.target)).to.equal(oneEther);
            expect(await weth.balanceOf(wallets.deployer.address)).to.equal(0n);
        });

        it("Should combine the eth and weth amounts", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            await weth.deposit({ value: oneEther });
            await weth.approve(sut.target, oneEther);

            await expect(sut.receiveValue(weth.target, oneEther, { value: oneEther }))
                .to.emit(sut, "ReceiveReturn")
                .withArgs(oneEther * 2n);

            expect(await weth.balanceOf(sut.target)).to.equal(oneEther * 2n);
            expect(await weth.balanceOf(wallets.deployer.address)).to.equal(0n);
        });
    });

    describe("_sendValue", function () {
        it("Should revert if transfer returns false", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(sut.target, oneEther);

            await token.mockReturn();

            await expect(sut.sendValue(token.target, wallets.deployer.address, oneEther))
                .to.be.revertedWithCustomError(sut, "SafeERC20FailedOperation")
                .withArgs(token.target);
        });

        it("Should revert if the contract has insufficient funds", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await expect(sut.sendValue(token.target, wallets.deployer.address, oneEther))
                .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
                .withArgs(sut.target, 0, oneEther);
        });

        it("Should do nothing if the amount is zero", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await sut.sendValue(token.target, wallets.recipient.address, 0n);

            expect(await token.balanceOf(wallets.recipient.address)).to.equal(0n);
            expect(await token.balanceOf(sut.target)).to.equal(0n);
        });

        it("Should send the token to the recipient", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(sut.target, oneEther);

            await sut.sendValue(token.target, wallets.recipient.address, oneEther);

            expect(await token.balanceOf(wallets.recipient.address)).to.equal(oneEther);
            expect(await token.balanceOf(sut.target)).to.equal(0n);
        });
    });
});
