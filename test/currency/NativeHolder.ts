import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

const oneEther = ethers.parseEther("1");

describe("NativeHolder", function () {
    async function fixture() {
        const [_, wallet] = await ethers.getSigners();

        const NativeBlocking = await ethers.getContractFactory("NativeBlocking");
        const nativeBlocking = await NativeBlocking.deploy();
        await nativeBlocking.waitForDeployment();

        const NativeReceiving = await ethers.getContractFactory("NativeReceiving");
        const nativeReceiving = await NativeReceiving.deploy();
        await nativeReceiving.waitForDeployment();

        const SUT = await ethers.getContractFactory("NativeHolderHarness");
        const sut = await SUT.deploy();

        return {
            sut,
            nativeBlocking,
            nativeReceiving,
            wallet: wallet,
        };
    }

    // ############################ TESTS ############################

    describe("_getBalance", function () {
        it("Should initially return 0", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.balance()).to.equal(0);
        });

        it("Should return the contract token balance", async function () {
            const { sut } = await loadFixture(fixture);

            await sut.receiveValue(oneEther, { value: oneEther });

            expect(await sut.balance()).to.equal(oneEther);
        });
    });

    describe("_receiveValue", function () {
        it("Should revert if msg.value does not match the value", async function () {
            const { sut } = await loadFixture(fixture);

            await expect(sut.receiveValue(oneEther)).to.be.revertedWithCustomError(sut, "NativeHolderInvalidReceive");
        });

        it("Should send the amount from the caller to the contract", async function () {
            const { sut, wallet } = await loadFixture(fixture);

            const provider = ethers.provider;
            const walletBalanceBefore = await provider.getBalance(wallet.address);
            const sutBalanceBefore = await provider.getBalance(sut.target);

            const tx = await sut.connect(wallet).receiveValue(oneEther, { value: oneEther });
            const receipt = await tx.wait();

            let fee = 0n
            if(receipt) {
                fee = receipt.fee;
            }

            expect(await provider.getBalance(wallet.address)).to.equal(walletBalanceBefore - oneEther - fee);
            expect(await provider.getBalance(sut.target)).to.equal(sutBalanceBefore + oneEther);
        });
    });

    describe("_sendValue", function () {
        it("Should revert if the contract has insufficient funds", async function () {
            const { sut, wallet } = await loadFixture(fixture);

            await expect(sut.sendValue(wallet.address, oneEther)).to.be.revertedWithCustomError(
                sut,
                "NativeHolderTransferFailed"
            );
        });

        it("Should revert if sending to a contract with no receive", async function () {
            const { sut, nativeBlocking } = await loadFixture(fixture);

            await sut.receiveValue(oneEther, { value: oneEther });

            await expect(sut.sendValue(nativeBlocking.target, oneEther)).to.be.revertedWithCustomError(
                sut,
                "NativeHolderTransferFailed"
            );
        });

        it("Should send the token from the contract to the wallet", async function () {
            const { sut, wallet } = await loadFixture(fixture);

            await sut.receiveValue(oneEther, { value: oneEther });

            const provider = ethers.provider;
            const walletBalanceBefore = await provider.getBalance(wallet.address);
            const sutBalanceBefore = await provider.getBalance(sut.target);

            await sut.sendValue(wallet.address, oneEther);

            expect(await provider.getBalance(wallet.address)).to.equal(walletBalanceBefore + oneEther);
            expect(await provider.getBalance(sut.target)).to.equal(sutBalanceBefore - oneEther);
        });

        it("Should send the token from the contract to another contract", async function () {
            const { sut, nativeReceiving } = await loadFixture(fixture);

            await sut.receiveValue(oneEther, { value: oneEther });

            const provider = ethers.provider;
            const contractBalanceBefore = await provider.getBalance(nativeReceiving.target);
            const sutBalanceBefore = await provider.getBalance(sut.target);

            await sut.sendValue(nativeReceiving.target, oneEther);

            expect(await provider.getBalance(nativeReceiving.target)).to.equal(contractBalanceBefore + oneEther);
            expect(await provider.getBalance(sut.target)).to.equal(sutBalanceBefore - oneEther);
        });
    });
});
