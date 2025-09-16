import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

const oneEther = ethers.parseEther("1");
const minimumValue = 50n;

describe("TokenHolder", function () {
    async function fixture() {
        const [deployer] = await ethers.getSigners();

        const TOKEN = await ethers.getContractFactory("MockERC20");
        const token = await TOKEN.deploy();
        await token.waitForDeployment();

        const otherToken = await TOKEN.deploy();
        await otherToken.waitForDeployment();

        const SUT = await ethers.getContractFactory("TokenHolderHarness");
        const sut = await SUT.deploy(token.target, minimumValue);
        await sut.waitForDeployment();

        return {
            sut,
            token,
            otherToken,
            wallet: deployer,
        };
    }

    // ############################ TESTS ############################

    describe("constructor", function () {
        it("Should set the token address", async function () {
            const { sut, token } = await loadFixture(fixture);

            expect(await sut.token()).to.equal(token.target);
        });

        it("Should set minimum", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.getMinimum()).to.equal(minimumValue);
        });

        it("Should revert if minimum is passed as 0", async function () {
            const TOKEN = await ethers.getContractFactory("MockERC20");
            const token = await TOKEN.deploy();
            await token.waitForDeployment();

            const SUT = await ethers.getContractFactory("TokenHolderHarness");

            await expect(SUT.deploy(token.target, 0n)).to.be.revertedWithCustomError(SUT, "InvalidValue").withArgs(0n);
        });
    });

    describe("enforceMinimum", function () {
        it("Should revert if the value is less than the minimum", async function () {
            const { sut } = await loadFixture(fixture);

            await expect(sut.t_enforceMinimum(minimumValue - 1n))
                .to.be.revertedWithCustomError(sut, "ValueBelowMinimum")
                .withArgs(minimumValue - 1n);
        });

        it("Should NOT revert if the value is the minimum", async function () {
            const { sut } = await loadFixture(fixture);

            await expect(sut.t_enforceMinimum(minimumValue)).to.not.be.reverted;
        });

        it("Should NOT revert if the value is greater than the minimum", async function () {
            const { sut } = await loadFixture(fixture);

            await expect(sut.t_enforceMinimum(minimumValue + 1n)).to.not.be.reverted;
        });
    });

    describe("getMinimum", function () {
        it("Should return the minimum value", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.getMinimum()).to.equal(minimumValue);
        });
    });

    describe("setMinimum", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut } = await loadFixture(fixture);

            const [_, alice] = await ethers.getSigners();

            await expect(sut.connect(alice).setMinimum(10n)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if the value is 0", async function () {
            const { sut } = await loadFixture(fixture);

            await expect(sut.setMinimum(0n)).to.be.revertedWithCustomError(sut, "InvalidValue").withArgs(0n);
        });

        it("Should set the minimum", async function () {
            const { sut } = await loadFixture(fixture);

            const minimum = 10n;
            await sut.setMinimum(minimum);

            expect(await sut.getMinimum()).to.equal(minimum);
        });
    });

    describe("rescueTokens", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, otherToken } = await loadFixture(fixture);

            const [_, alice] = await ethers.getSigners();

            await expect(sut.connect(alice).rescueTokens(otherToken, alice.address)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if the token is the primary token", async function () {
            const { sut, token, wallet } = await loadFixture(fixture);

            const amount = oneEther;
            await token.mint(sut.target, amount);

            await expect(sut.rescueTokens(token.target, wallet.address))
                .to.be.revertedWithCustomError(sut, "InvalidAddress")
                .withArgs(token.target);
        });

        it("Should revert if the balance is 0", async function () {
            const { sut, otherToken, wallet } = await loadFixture(fixture);

            await expect(sut.rescueTokens(otherToken.target, wallet.address))
                .to.be.revertedWithCustomError(sut, "InvalidAddress")
                .withArgs(otherToken.target);
        });

        it("Should rescue the balance", async function () {
            const { sut, otherToken, wallet } = await loadFixture(fixture);

            const amount = oneEther;
            await otherToken.mint(sut.target, amount);

            const ownerBalanceBefore = await otherToken.balanceOf(wallet.address);
            const sutBalanceBefore = await otherToken.balanceOf(sut.target);

            await sut.rescueTokens(otherToken.target, wallet.address);

            expect(await otherToken.balanceOf(sut.target)).to.equal(sutBalanceBefore - amount);
            expect(await otherToken.balanceOf(wallet.address)).to.equal(ownerBalanceBefore + amount);
        });
    });

    describe("_stageAmount", function () {
        it("Should increment the staged balance", async function () {
            const { sut } = await loadFixture(fixture);

            await sut.stageAmount(oneEther); // Staged balance is now 0.25 ether

            expect(await sut.getStagedBalance()).to.equal(oneEther);
        });

        it("Should emit StagedBalanceIncreased", async function () {
            const { sut } = await loadFixture(fixture);

            await expect(sut.stageAmount(oneEther)).to.emit(sut, "StagedBalanceIncreased").withArgs(oneEther);
        });
    });

    describe("_unstageAmount", function () {
        it("Should revert if the staged balance is less than the amount", async function () {
            const { sut } = await loadFixture(fixture);

            await sut.stageAmount(oneEther / 2n); // Staged balance is now 0.5 ether

            await expect(sut.unstageAmount(oneEther)).to.be.revertedWithCustomError(sut, "InsufficientStagedBalance");
        });

        it("Should reduce the staged balance by the amount when amount is the staged balance", async function () {
            const { sut } = await loadFixture(fixture);

            await sut.stageAmount(oneEther); // Staged balance is now 1 ether
            await sut.unstageAmount(oneEther); // Staged balance should now be 0 ether

            expect(await sut.getStagedBalance()).to.equal(0);
        });

        it("Should reduce the staged balance by the amount when amount is less than the staged balance", async function () {
            const { sut } = await loadFixture(fixture);

            await sut.stageAmount(oneEther); // Staged balance is now 1 ether
            await sut.unstageAmount(oneEther / 4n); // Staged balance should now be 0.25 ether

            // Staged balance should now be 0.75 ether
            expect(await sut.getStagedBalance()).to.equal((oneEther / 4n) * 3n);
        });

        it("Should emit StagedBalanceDecreased", async function () {
            const { sut } = await loadFixture(fixture);

            await sut.stageAmount(oneEther); // Staged balance is now 1 ether
            await expect(sut.unstageAmount(oneEther / 4n))
                .to.emit(sut, "StagedBalanceDecreased")
                .withArgs(oneEther / 4n);
        });
    });

    describe("_getAvailableBalance", function () {
        it("Should return the balance - the staged balance", async function () {
            const { sut, token, wallet } = await loadFixture(fixture);

            await token.mint(wallet.address, oneEther);
            await token.approve(sut.target, oneEther);

            await sut.receiveValue(oneEther); // Balance is now 1 ether
            await sut.stageAmount(oneEther / 4n); // Staged balance is now 0.25 ether

            // Available balance should be 0.75 ether
            expect(await sut.getAvailableBalance()).to.equal((oneEther / 4n) * 3n);
        });
    });

    describe("_getBalance", function () {
        it("Should initially return 0", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.getBalance()).to.equal(0);
        });

        it("Should return the contract token balance", async function () {
            const { sut, token } = await loadFixture(fixture);

            await token.mint(sut.target, oneEther);

            expect(await sut.getBalance()).to.equal(oneEther);
        });
    });

    describe("_receiveValue", function () {
        it("Should revert if transferFrom returns false", async function () {
            const { sut, token, wallet } = await loadFixture(fixture);

            await token.mint(wallet.address, oneEther);
            await token.approve(sut.target, oneEther);

            await token.mockReturn();

            await expect(sut.receiveValue(oneEther))
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

        it("Should send the token amount from the caller to the contract", async function () {
            const { sut, token, wallet } = await loadFixture(fixture);

            await token.mint(wallet.address, oneEther);
            await token.approve(sut.target, oneEther);

            expect(await token.balanceOf(wallet.address)).to.equal(oneEther);
            expect(await token.balanceOf(sut.target)).to.equal(0);

            await sut.receiveValue(oneEther);

            expect(await token.balanceOf(wallet.address)).to.equal(0);
            expect(await token.balanceOf(sut.target)).to.equal(oneEther);
        });

        it("Should return 0 if the amount is 0", async function () {
            const { sut } = await loadFixture(fixture);

            await expect(sut.receiveValue(0n)).to.emit(sut, "ReceivedValue").withArgs(0n);
        });

        it("Should return the amount", async function () {
            const { sut, token, wallet } = await loadFixture(fixture);

            await token.mint(wallet.address, oneEther);
            await token.approve(sut.target, oneEther);

            await expect(sut.receiveValue(oneEther)).to.emit(sut, "ReceivedValue").withArgs(oneEther);
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

        it("Should send the token from the contract to the wallet", async function () {
            const { sut, token, wallet } = await loadFixture(fixture);

            await token.mint(sut.target, oneEther);

            expect(await token.balanceOf(wallet.address)).to.equal(0);
            expect(await token.balanceOf(sut.target)).to.equal(oneEther);

            await sut.sendValue(wallet.address, oneEther);

            expect(await token.balanceOf(wallet.address)).to.equal(oneEther);
            expect(await token.balanceOf(sut.target)).to.equal(0);
        });
    });
});
