import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

const oneEther = ethers.parseEther("1");

describe.only("TokenReceiver", function () {
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

            expect(await sut.weth()).to.equal(weth.target);
        });
    });

    describe("_receiveValue", function () {
        it("Should revert when sending ether but not WETH", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);
        });

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
            const { sut, token, wallet } = await loadFixture(fixture);

            await token.mint(wallet.address, oneEther);

            await expect(sut.receiveValue(oneEther))
                .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
                .withArgs(sut.target, 0, oneEther);
        });

        it("Should revert if the sender has insufficient funds", async function () {
            const { sut, token, wallet } = await loadFixture(fixture);

            await token.approve(sut.target, oneEther);

            await expect(sut.receiveValue(oneEther))
                .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
                .withArgs(wallet.address, 0, oneEther);
        });

        it("Should ", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);
        });

        it("Should ", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);
        });

        it("Should ", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);
        });

        it("Should ", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);
        });

        it("Should ", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);
        });
    });

    describe("_sendValue", function () {
        it("Should revert if transfer returns false", async function () {
            const { sut, token, wallet } = await loadFixture(fixture);

            await token.mint(sut.target, oneEther);

            await token.mockReturn();

            await expect(sut.sendValue(wallet.address, oneEther))
                .to.be.revertedWithCustomError(sut, "SafeERC20FailedOperation")
                .withArgs(token.target);
        });

        it("Should revert if the contract has insufficient funds", async function () {
            const { sut, wallet } = await loadFixture(fixture);

            await expect(sut.sendValue(wallet.address, oneEther)).to.be.revertedWithCustomError(
                sut,
                "InsufficientAvailableBalance"
            );
        });

        it("Should ", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);
        });

        it("Should ", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);
        });

        it("Should ", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);
        });

        it("Should ", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);
        });

        it("Should ", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);
        });

        it("Should ", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);
        });
    });
});
