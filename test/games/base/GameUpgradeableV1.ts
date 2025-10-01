import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { GameUpgradeableV1Harness } from "../../../typechain-types";

const oneEther = ethers.parseEther("1");

describe("GameUpgradeableV1", function () {
    async function fixture() {
        const [deployer, randomness, platform] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const token = await MockERC20.deploy();
        await token.waitForDeployment();

        const MockLiquidity = await ethers.getContractFactory("MockLiquidity");
        const liquidity = await MockLiquidity.deploy();
        await liquidity.waitForDeployment();

        const IMPL = await ethers.getContractFactory("GameUpgradeableV1Harness");
        const impl = await IMPL.deploy(platform.address, randomness.address, liquidity.target);
        await impl.waitForDeployment();

        const PROXY = await ethers.getContractFactory("ERC1967Proxy");
        const proxy = await PROXY.deploy(
            impl.target,
            IMPL.interface.encodeFunctionData("initialize", [deployer.address])
        );
        await proxy.waitForDeployment();

        const sut = IMPL.attach(proxy.target) as GameUpgradeableV1Harness;

        return {
            sut,
            impl,
            token,
            liquidity,
            wallets: {
                deployer,
                platform,
                randomness,
            },
        };
    }

    describe("constructor", function () {
        it("Should set the platform", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            expect(await sut.getPlatform()).to.equal(wallets.platform.address);
        });

        it("Should set the randomness", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            expect(await sut.getRandomness()).to.equal(wallets.randomness.address);
        });

        it("Should set the liquidity", async function () {
            const { sut, liquidity } = await loadFixture(fixture);

            expect(await sut.getLiquidity()).to.equal(liquidity.target);
        });

        it("Should disable the initializers", async function () {
            const { impl, wallets } = await loadFixture(fixture);

            await expect(impl.initialize(wallets.deployer.address)).to.be.revertedWithCustomError(
                impl,
                "InvalidInitialization"
            );
        });
    });

    describe("initialize", function () {
        it("Should set the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            expect(await sut.owner()).to.equal(wallets.deployer.address);
        });

        it("Should not be callable again", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.initialize(wallets.deployer.address)).to.be.revertedWithCustomError(
                sut,
                "InvalidInitialization"
            );
        });
    });

    describe("onlyRandomness", function () {
        it("Should revert if the caller is not the randomness", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.deployer).m_onlyRandomness()).to.be.revertedWithCustomError(
                sut,
                "CallerNotRandomness"
            );
        });

        it("Should not revert if the caller is the randomness", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.randomness).m_onlyRandomness()).to.not.be.reverted;
        });
    });

    describe("enableToken", function () {
        it("Should revert if the caller is not the platform", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.deployer).enableToken(token.target)).to.be.revertedWithCustomError(
                sut,
                "CallerNotPlatform"
            );
        });

        it("Should max approve liquidity to access the games token", async function () {
            const { sut, token, liquidity, wallets } = await loadFixture(fixture);

            await sut.connect(wallets.platform).enableToken(token.target);

            expect(await token.allowance(sut.target, liquidity.target)).to.equal(ethers.MaxUint256);
        });
    });

    describe("processBet", function () {
        const data = ethers.toUtf8Bytes("0xdeadbeef");
        const amount = oneEther * 2n;

        it("Should revert if the caller is not the platform", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.platform.address, oneEther * 10n);
            await token.connect(wallets.platform).approve(sut.target, amount);

            await expect(
                sut.connect(wallets.deployer).processBet(wallets.deployer.address, token.target, amount, data)
            ).to.be.revertedWithCustomError(sut, "CallerNotPlatform");
        });

        it("Should revert if the platform has insufficient approval", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.platform.address, oneEther * 10n);

            await expect(
                sut.connect(wallets.platform).processBet(wallets.deployer.address, token.target, amount, data)
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
        });

        it("Should revert if the platform has insufficient balance", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.connect(wallets.platform).approve(sut.target, amount);

            await expect(
                sut.connect(wallets.platform).processBet(wallets.deployer.address, token.target, amount, data)
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });

        it("Should receive the token amount", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.platform.address, oneEther * 10n);
            await token.connect(wallets.platform).approve(sut.target, amount);

            const platformBalanceBefore = await token.balanceOf(wallets.platform.address);
            const sutBalanceBefore = await token.balanceOf(sut.target);

            await sut.connect(wallets.platform).processBet(wallets.deployer.address, token.target, amount, data);

            const platformBalanceAfter = await token.balanceOf(wallets.platform.address);
            const sutBalanceAfter = await token.balanceOf(sut.target);

            expect(platformBalanceAfter).to.equal(platformBalanceBefore - amount);
            expect(sutBalanceAfter).to.equal(sutBalanceBefore + amount);
        });

        it("Should call _processBet", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.platform.address, oneEther * 10n);
            await token.connect(wallets.platform).approve(sut.target, amount);

            await expect(sut.connect(wallets.platform).processBet(wallets.deployer.address, token.target, amount, data))
                .to.emit(sut, "ProcessBet")
                .withArgs(wallets.deployer.address, token.target, amount, data);
        });
    });

    describe("_maxExposure", function () {
        it("Should forward the call to the liquidity", async function () {
            const { sut, liquidity, token } = await loadFixture(fixture);

            const mockExposure = oneEther * 5n;
            await liquidity.setMockExposure(token.target, mockExposure);

            expect(await sut.maxExposure(token.target)).to.equal(mockExposure);
        });
    });

    describe("_requestLiquidity", function () {
        it("Should forward the call to the liquidity", async function () {
            const { sut, liquidity, token } = await loadFixture(fixture);

            const mockRequestId = 1;
            await liquidity.setMockRequestId(mockRequestId);

            const amount = oneEther * 3n;

            await expect(sut.requestLiquidity(token.target, amount))
                .to.emit(liquidity, "RequestLiquidity")
                .withArgs(token.target, amount, mockRequestId)
                .and.to.emit(sut, "RequestLiquidity")
                .withArgs(mockRequestId, amount);
        });
    });

    describe("_settleLiquidityRequest", function () {
        it("Should forward the call to the liquidity", async function () {
            const { sut, liquidity, token } = await loadFixture(fixture);

            const requestId = 1n;

            const incoming = oneEther;
            const outgoing = oneEther * 2n;

            await expect(sut.settleLiquidityRequest(requestId, token.target, incoming, outgoing))
                .to.emit(liquidity, "SettleRequestedLiquidity")
                .withArgs(requestId, token.target, incoming, outgoing);
        });
    });

    describe("_authorizeUpgrade", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, liquidity, wallets } = await loadFixture(fixture);

            const IMPL = await ethers.getContractFactory("GameUpgradeableV1Harness");
            const impl = await IMPL.deploy(wallets.platform.address, wallets.randomness.address, liquidity.target);
            await impl.waitForDeployment();

            await expect(
                sut.connect(wallets.platform).upgradeToAndCall(impl.target, "0x")
            ).to.be.revertedWithCustomError(sut, "OwnableUnauthorizedAccount");
        });

        it("Should allow the owner to upgrade", async function () {
            const { sut, liquidity, wallets } = await loadFixture(fixture);

            const IMPL = await ethers.getContractFactory("GameUpgradeableV1Harness");
            const impl = await IMPL.deploy(wallets.deployer.address, wallets.randomness.address, liquidity.target);
            await impl.waitForDeployment();

            await expect(sut.connect(wallets.deployer).upgradeToAndCall(impl.target, "0x")).to.not.be.reverted;

            expect(await sut.getPlatform()).to.equal(wallets.deployer.address);
        });
    });
});
