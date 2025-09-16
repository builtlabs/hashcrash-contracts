import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("WrappedContext", function () {
    async function fixture() {
        const WETH = await ethers.getContractFactory("WETH9");
        const weth = await WETH.deploy();
        await weth.waitForDeployment();

        const SUT = await ethers.getContractFactory("WrappedContextHarness");
        const sut = await SUT.deploy(weth.target);

        return {
            sut,
            weth,
        };
    }

    // ############################ TESTS ############################

    describe("constructor", function () {
        it("Should set WETH address", async function () {
            const { sut, weth } = await loadFixture(fixture);

            expect(await sut.getWETH()).to.equal(weth.target);
        });
    });

    describe("nativeToWrapped", function () {
        it("Should revert if the eth transfer fails", async function () {
            const TOKEN = await ethers.getContractFactory("DemoERC20");
            const token = await TOKEN.deploy();
            await token.waitForDeployment();

            const SUT = await ethers.getContractFactory("WrappedContextHarness");
            const sut = await SUT.deploy(token.target);

            await expect(
                sut.nativeToWrapped({
                    value: ethers.parseEther("1"),
                })
            ).to.be.revertedWithCustomError(sut, "NativeToWrappedFailed");
        });

        it("Should return 0 when the msg.value is zero", async function () {
            const { sut } = await loadFixture(fixture);

            await expect(sut.nativeToWrapped({
                value: 0
            })).to.emit(sut, "NativeToWrappedCalled").withArgs(0);
        });

        it("Should return msg.value", async function () {
            const { sut } = await loadFixture(fixture);

            const value = ethers.parseEther("1");

            await expect(sut.nativeToWrapped({
                value: value
            })).to.emit(sut, "NativeToWrappedCalled").withArgs(value);
        });

        it("Should wrap msg.value", async function () {
            const { sut, weth } = await loadFixture(fixture);

            const value = ethers.parseEther("1");

            await sut.nativeToWrapped({
                value: value
            });

            expect(await weth.balanceOf(sut.target)).to.equal(value);
            expect(await ethers.provider.getBalance(sut.target)).to.equal(0);
        });
    });
});
