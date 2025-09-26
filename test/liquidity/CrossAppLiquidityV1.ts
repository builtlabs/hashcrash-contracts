import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { BytesLike, hexlify, id, randomBytes } from "ethers";
import hre, { ethers } from "hardhat";
import { CrossAppLiquidityV1 } from "../../typechain-types";

const oneEther = ethers.parseEther("1");

// TODO: Integration tests to make sure withdraw, request etc all use the correct kind of balance. Available vs Theory.

describe.only("CrossAppLiquidityV1", function () {
    async function fixture() {
        const [deployer, gasFund, rewardFund, oracle, user] = await ethers.getSigners();

        await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x0000000000000000000000000000000000008001"],
        });

        const bootloader = await ethers.getSigner("0x0000000000000000000000000000000000008001");

        const WETHMock = await ethers.getContractFactory("WETH9");
        const weth = await WETHMock.deploy();
        await weth.waitForDeployment();

        const MockERC20 = await ethers.getContractFactory("MockERC20");

        const allowedToken = await MockERC20.deploy();
        await allowedToken.waitForDeployment();

        const blockedToken = await MockERC20.deploy();
        await blockedToken.waitForDeployment();

        const IMPL = await ethers.getContractFactory("CrossAppLiquidityV1");
        const impl = await IMPL.deploy(oracle.address, gasFund.address, rewardFund.address, weth.target);
        await impl.waitForDeployment();

        const PROXY = await ethers.getContractFactory("ERC1967Proxy");
        const proxy = await PROXY.deploy(
            impl.target,
            IMPL.interface.encodeFunctionData("initialize", [deployer.address])
        );
        await proxy.waitForDeployment();

        const sut = IMPL.attach(proxy.target) as CrossAppLiquidityV1;

        const MockApp = await ethers.getContractFactory("MockApp");
        const app = await MockApp.deploy(sut.target);
        await app.waitForDeployment();

        const wethSettings = {
            enabled: true,
            feeBPS: 50,
            bufferBPS: 500,
            maxExposureBPS: 100,
            minShareValue: ethers.parseEther("0.001"),
        };
        const allowedTokenSettings = {
            enabled: true,
            feeBPS: 50,
            bufferBPS: 500,
            maxExposureBPS: 100,
            minShareValue: ethers.parseEther("1000"),
        };

        await sut.setAccessLevel(app.target, 2);
        await sut.setMultipleTokenSettings([
            {
                token: weth,
                settings: wethSettings,
            },
            {
                token: allowedToken.target,
                settings: allowedTokenSettings,
            },
        ]);

        return {
            sut,
            impl,
            app,
            weth,
            allowedToken,
            blockedToken,
            settings: {
                weth: wethSettings,
                allowedToken: allowedTokenSettings,
            },
            wallets: {
                deployer,
                bootloader,
                gasFund,
                rewardFund,
                oracle,
                user,
            },
        };
    }

    async function fixtureWithDeposit() {
        const data = await fixture();

        const { sut, weth, allowedToken, settings, wallets } = data;

        const wethAmount = settings.weth.minShareValue * 10n;
        const allowedTokenAmount = settings.allowedToken.minShareValue * 10n;

        await allowedToken.mint(wallets.deployer.address, allowedTokenAmount);
        await allowedToken.approve(sut.target, allowedTokenAmount);

        await sut.deposit(weth.target, 0n, { value: wethAmount });
        await sut.deposit(allowedToken.target, allowedTokenAmount);

        return {
            ...data,
            amounts: {
                weth: wethAmount,
                token: allowedTokenAmount,
            },
        };
    }

    describe("constructor", function () {
        it("Should set the oracle", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            expect(await sut.getOracle()).to.equal(wallets.oracle.address);
        });

        it("Should set the gas fund", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            expect(await sut.getGasFund()).to.equal(wallets.gasFund.address);
        });

        it("Should set the reward fund", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            expect(await sut.getRewardFund()).to.equal(wallets.rewardFund.address);
        });

        it("Should set the weth address", async function () {
            const { sut, weth } = await loadFixture(fixture);

            expect(await sut.getWeth()).to.equal(weth.target);
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

        it("Should set the access level to 1", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.getAccessLevel(sut.target)).to.equal(1);
        });

        it("Should not be callable again", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.initialize(wallets.deployer.address)).to.be.revertedWithCustomError(
                sut,
                "InvalidInitialization"
            );
        });
    });

    describe("setAccessLevel", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.user).setAccessLevel(sut.target, 1)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should set the access level", async function () {
            const { sut } = await loadFixture(fixture);

            await sut.setAccessLevel(sut.target, 2);

            expect(await sut.getAccessLevel(sut.target)).to.equal(2);
        });

        it("Should emit AccessLevelUpdated", async function () {
            const { sut } = await loadFixture(fixture);

            await expect(sut.setAccessLevel(sut.target, 2)).to.emit(sut, "AccessLevelUpdated").withArgs(sut.target, 2);
        });
    });

    describe("setAccessLevels", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(
                sut.connect(wallets.user).setAccessLevels([
                    { addr: wallets.user.address, value: 1 },
                    { addr: wallets.oracle.address, value: 2 },
                ])
            ).to.be.revertedWithCustomError(sut, "OwnableUnauthorizedAccount");
        });

        it("Should set multiple access levels", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await sut.setAccessLevels([
                { addr: wallets.user.address, value: 1 },
                { addr: wallets.oracle.address, value: 2 },
            ]);

            expect(await sut.getAccessLevel(wallets.user.address)).to.equal(1);
            expect(await sut.getAccessLevel(wallets.oracle.address)).to.equal(2);
        });

        it("Should emit multiple AccessLevelUpdated", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(
                sut.setAccessLevels([
                    { addr: wallets.user.address, value: 1 },
                    { addr: wallets.oracle.address, value: 2 },
                ])
            )
                .to.emit(sut, "AccessLevelUpdated")
                .withArgs(wallets.user.address, 1)
                .to.emit(sut, "AccessLevelUpdated")
                .withArgs(wallets.oracle.address, 2);
        });
    });

    describe("setTokenSettings", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(
                sut.connect(wallets.user).setTokenSettings(wallets.user.address, {
                    enabled: true,
                    feeBPS: 1,
                    bufferBPS: 2,
                    maxExposureBPS: 3,
                    minShareValue: 4,
                })
            ).to.be.revertedWithCustomError(sut, "OwnableUnauthorizedAccount");
        });

        it("Should set the token settings", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await sut.setTokenSettings(wallets.user.address, {
                enabled: true,
                feeBPS: 1,
                bufferBPS: 2,
                maxExposureBPS: 3,
                minShareValue: 4,
            });

            const settings = await sut.getTokenSettings(wallets.user.address);

            expect(settings.enabled).to.equal(true);
            expect(settings.feeBPS).to.equal(1);
            expect(settings.bufferBPS).to.equal(2);
            expect(settings.maxExposureBPS).to.equal(3);
            expect(settings.minShareValue).to.equal(4);
        });

        it("Should emit TokenSettingsUpdated", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(
                sut.setTokenSettings(wallets.user.address, {
                    enabled: true,
                    feeBPS: 1,
                    bufferBPS: 2,
                    maxExposureBPS: 3,
                    minShareValue: 4,
                })
            )
                .to.emit(sut, "TokenSettingsUpdated")
                .withArgs(wallets.user.address, [true, 1, 2, 3, 4]);
        });
    });

    describe("setMultipleTokenSettings", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, settings, wallets } = await loadFixture(fixture);

            await expect(
                sut
                    .connect(wallets.user)
                    .setMultipleTokenSettings([{ token: wallets.user.address, settings: settings.weth }])
            ).to.be.revertedWithCustomError(sut, "OwnableUnauthorizedAccount");
        });

        it("Should set multiple token settings", async function () {
            const { sut, settings, wallets } = await loadFixture(fixture);

            await sut.setMultipleTokenSettings([
                { token: wallets.user.address, settings: settings.weth },
                { token: wallets.bootloader.address, settings: settings.allowedToken },
            ]);

            const userSettings = await sut.getTokenSettings(wallets.user.address);
            const bootLoaderSettings = await sut.getTokenSettings(wallets.bootloader.address);

            expect(userSettings.enabled).to.equal(settings.weth.enabled);
            expect(userSettings.feeBPS).to.equal(settings.weth.feeBPS);
            expect(userSettings.bufferBPS).to.equal(settings.weth.bufferBPS);
            expect(userSettings.maxExposureBPS).to.equal(settings.weth.maxExposureBPS);
            expect(userSettings.minShareValue).to.equal(settings.weth.minShareValue);

            expect(bootLoaderSettings.enabled).to.equal(settings.allowedToken.enabled);
            expect(bootLoaderSettings.feeBPS).to.equal(settings.allowedToken.feeBPS);
            expect(bootLoaderSettings.bufferBPS).to.equal(settings.allowedToken.bufferBPS);
            expect(bootLoaderSettings.maxExposureBPS).to.equal(settings.allowedToken.maxExposureBPS);
            expect(bootLoaderSettings.minShareValue).to.equal(settings.allowedToken.minShareValue);
        });

        it("Should emit multiple TokenSettingsUpdated", async function () {
            const { sut, settings, wallets } = await loadFixture(fixture);

            await expect(
                sut.setMultipleTokenSettings([
                    { token: wallets.user.address, settings: settings.weth },
                    { token: wallets.bootloader.address, settings: settings.allowedToken },
                ])
            )
                .to.emit(sut, "TokenSettingsUpdated")
                .withArgs(wallets.user.address, Object.values(settings.weth))
                .to.emit(sut, "TokenSettingsUpdated")
                .withArgs(wallets.bootloader.address, Object.values(settings.allowedToken));
        });
    });

    describe("withdrawGas", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await wallets.deployer.sendTransaction({ to: sut.target, value: oneEther });

            await expect(sut.connect(wallets.user).withdrawGas(oneEther)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if sending the ether to a contract that cannot receive", async function () {
            const { sut, weth, app, wallets } = await loadFixture(fixture);

            const IMPL = await ethers.getContractFactory("CrossAppLiquidityV1");
            const impl = await IMPL.deploy(
                wallets.user.address,
                app.target,
                wallets.rewardFund.address,
                weth.target
            );
            await impl.waitForDeployment();

            await sut.connect(wallets.deployer).upgradeToAndCall(impl.target, "0x");

            await wallets.deployer.sendTransaction({ to: sut.target, value: oneEther });

            await expect(sut.withdrawGas(oneEther)).to.be.revertedWithCustomError(
                sut,
                "FailedToTransferEther"
            );
        });

        it("Should send the amount to the gas fund", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await wallets.deployer.sendTransaction({ to: sut.target, value: oneEther });

            const balanceBefore = await ethers.provider.getBalance(wallets.gasFund.address);

            await sut.withdrawGas(oneEther);

            const balanceAfter = await ethers.provider.getBalance(wallets.gasFund.address);

            expect(balanceAfter - balanceBefore).to.equal(oneEther);
        });
    });

    describe("withdrawAllGas", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await wallets.deployer.sendTransaction({ to: sut.target, value: oneEther });

            await expect(sut.connect(wallets.user).withdrawAllGas()).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if sending the ether to a contract that cannot receive", async function () {
            const { sut, weth, app, wallets } = await loadFixture(fixture);

            const IMPL = await ethers.getContractFactory("CrossAppLiquidityV1");
            const impl = await IMPL.deploy(
                wallets.user.address,
                app.target,
                wallets.rewardFund.address,
                weth.target
            );
            await impl.waitForDeployment();

            await sut.connect(wallets.deployer).upgradeToAndCall(impl.target, "0x");

            await wallets.deployer.sendTransaction({ to: sut.target, value: oneEther });

            await expect(sut.withdrawAllGas()).to.be.revertedWithCustomError(
                sut,
                "FailedToTransferEther"
            );
        });

        it("Should send the entire eth balance to the gas fund", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await wallets.deployer.sendTransaction({ to: sut.target, value: oneEther });

            const balanceBefore = await ethers.provider.getBalance(wallets.gasFund.address);

            await sut.withdrawAllGas();

            const balanceAfter = await ethers.provider.getBalance(wallets.gasFund.address);

            expect(balanceAfter - balanceBefore).to.equal(oneEther);
        });
    });

    describe("setExchangeRate", function () {
        it("Should revert if the caller is not the oracle", async function () {
            const { sut, allowedToken, wallets } = await loadFixture(fixture);

            await expect(
                sut.connect(wallets.user).setExchangeRate(allowedToken.target, oneEther)
            ).to.be.revertedWithCustomError(sut, "NotOracle");
        });

        it("Should set the exchange rate", async function () {
            const { sut, allowedToken, wallets } = await loadFixture(fixture);

            await sut.connect(wallets.oracle).setExchangeRate(allowedToken.target, oneEther);

            expect(await sut.getExchangeRate(allowedToken.target)).to.equal(oneEther);
        });

        it("Should emit ExchangeRateUpdated", async function () {
            const { sut, allowedToken, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.oracle).setExchangeRate(allowedToken.target, oneEther))
                .to.emit(sut, "ExchangeRateUpdated")
                .withArgs(allowedToken.target, oneEther);
        });
    });

    describe("setMultipleExchangeRates", function () {
        it("Should revert if the caller is not the oracle", async function () {
            const { sut, weth, allowedToken, wallets } = await loadFixture(fixture);

            await expect(
                sut.connect(wallets.user).setMultipleExchangeRates([
                    { addr: weth, value: oneEther },
                    { addr: allowedToken.target, value: oneEther },
                ])
            ).to.be.revertedWithCustomError(sut, "NotOracle");
        });

        it("Should set multiple exchange rates", async function () {
            const { sut, weth, allowedToken, wallets } = await loadFixture(fixture);

            await sut.connect(wallets.oracle).setMultipleExchangeRates([
                { addr: weth.target, value: oneEther },
                { addr: allowedToken.target, value: oneEther },
            ]);

            expect(await sut.getMultipleExchangeRates([weth, allowedToken.target])).to.deep.eq([
                [weth.target, oneEther],
                [allowedToken.target, oneEther],
            ]);
        });

        it("Should emit multiple ExchangeRateUpdated", async function () {
            const { sut, weth, allowedToken, wallets } = await loadFixture(fixture);

            await expect(
                sut.connect(wallets.oracle).setMultipleExchangeRates([
                    { addr: weth.target, value: oneEther },
                    { addr: allowedToken.target, value: oneEther },
                ])
            )
                .to.emit(sut, "ExchangeRateUpdated")
                .withArgs(weth.target, oneEther)
                .to.emit(sut, "ExchangeRateUpdated")
                .withArgs(allowedToken.target, oneEther);
        });
    });

    describe("deposit", function () {
        it("Should revert if the token is not enabled", async function () {
            const { sut, blockedToken, wallets } = await loadFixture(fixture);

            await blockedToken.mint(wallets.user.address, oneEther);
            await blockedToken.connect(wallets.user).approve(sut.target, oneEther);

            await expect(sut.connect(wallets.user).deposit(blockedToken.target, oneEther))
                .to.be.revertedWithCustomError(sut, "TokenNotEnabled")
                .withArgs(blockedToken.target);
        });

        it("Should revert if the deposit is below the minShareValue", async function () {
            const { sut, weth, settings, wallets } = await loadFixture(fixture);

            const amount = settings.weth.minShareValue - 1n;

            await expect(
                sut.connect(wallets.user).deposit(weth.target, 0n, {
                    value: amount,
                })
            ).to.be.revertedWithCustomError(sut, "InsufficientShareValue");
        });

        it("Should update the total shares", async function () {
            const { sut, weth, settings, wallets } = await loadFixture(fixture);

            const amount = settings.weth.minShareValue * 10n;

            await sut.connect(wallets.user).deposit(weth.target, 0n, {
                value: amount,
            });

            expect(await sut.getTotalShares(weth.target)).to.equal(amount);
        });

        it("Should update the user shares", async function () {
            const { sut, weth, settings, wallets } = await loadFixture(fixture);

            const amount = settings.weth.minShareValue * 10n;

            await sut.connect(wallets.user).deposit(weth.target, 0n, {
                value: amount,
            });

            expect(await sut.getUserShares(weth.target, wallets.user.address)).to.equal(amount);
        });

        it("Should give the correct amount of shares on the second deposit", async function () {
            const { sut, weth, settings, wallets } = await loadFixture(fixture);

            const amount1 = settings.weth.minShareValue * 10n;
            const amount2 = settings.weth.minShareValue * 20n;

            await sut.connect(wallets.user).deposit(weth.target, 0n, {
                value: amount1,
            });

            await sut.connect(wallets.deployer).deposit(weth.target, 0n, {
                value: amount2,
            });

            const userShares = await sut.getUserShares(weth.target, wallets.user.address);
            const deployerShares = await sut.getUserShares(weth.target, wallets.deployer.address);

            const totalShares = await sut.getTotalShares(weth.target);

            expect(userShares).to.equal(amount1);
            expect(deployerShares).to.equal(amount2);
            expect(totalShares).to.equal(userShares + deployerShares);
        });

        it("Should emit LiquidityAdded", async function () {
            const { sut, weth, settings, wallets } = await loadFixture(fixture);

            const amount = settings.weth.minShareValue * 10n;

            await expect(
                sut.connect(wallets.user).deposit(weth.target, 0n, {
                    value: amount,
                })
            )
                .to.emit(sut, "LiquidityAdded")
                .withArgs(wallets.user.address, weth.target, amount, amount);
        });

        it("Should receive the weth value", async function () {
            const { sut, weth, settings, wallets } = await loadFixture(fixture);

            const amount = settings.weth.minShareValue * 10n;
            const half = amount / 2n;

            await weth.connect(wallets.user).deposit({ value: half });
            await weth.connect(wallets.user).approve(sut.target, half);

            await sut.connect(wallets.user).deposit(weth.target, half, {
                value: half,
            });

            expect(await weth.balanceOf(sut.target)).to.equal(amount);
            expect(await weth.balanceOf(wallets.user.address)).to.equal(0n);
        });

        it("Should receive the token value", async function () {
            const { sut, allowedToken, settings, wallets } = await loadFixture(fixture);

            const amount = settings.allowedToken.minShareValue * 10n;

            await allowedToken.mint(wallets.deployer.address, amount);
            await allowedToken.approve(sut.target, amount);
            await sut.deposit(allowedToken.target, amount);

            expect(await allowedToken.balanceOf(sut.target)).to.equal(amount);
            expect(await allowedToken.balanceOf(wallets.deployer.address)).to.equal(0n);
        });

        it("Should revert if the receive fails", async function () {
            const { sut, allowedToken, wallets } = await loadFixture(fixture);

            await allowedToken.mint(wallets.deployer.address, oneEther);

            await expect(sut.deposit(allowedToken.target, oneEther))
                .to.revertedWithCustomError(allowedToken, "ERC20InsufficientAllowance")
                .withArgs(sut.target, 0, oneEther);
        });
    });

    describe("withdraw", function () {
        it("Should revert if the user has insufficient shares", async function () {
            const { sut, wallets, weth } = await loadFixture(fixtureWithDeposit);

            await expect(sut.connect(wallets.user).withdraw(weth.target, 1)).to.be.revertedWithCustomError(
                sut,
                "InsufficientShares"
            );
        });

        it("Should revert if the remaining balance in less than the min share value", async function () {
            const { sut, weth, settings, amounts } = await loadFixture(fixtureWithDeposit);

            const amount = amounts.weth - settings.weth.minShareValue + 1n;

            await expect(sut.withdraw(weth.target, amount)).to.be.revertedWithCustomError(
                sut,
                "InsufficientShareValue"
            );
        });

        it("Should update the users shares", async function () {
            const { sut, wallets, weth, settings } = await loadFixture(fixtureWithDeposit);

            const amount = settings.weth.minShareValue;
            const sharesBefore = await sut.getUserShares(weth.target, wallets.deployer.address);

            await sut.withdraw(weth.target, amount);

            expect(await sut.getUserShares(weth.target, wallets.deployer.address)).to.equal(sharesBefore - amount);
        });

        it("Should update the total shares", async function () {
            const { sut, weth, settings } = await loadFixture(fixtureWithDeposit);

            const amount = settings.weth.minShareValue;
            const totalSharesBefore = await sut.getTotalShares(weth.target);

            await sut.withdraw(weth.target, amount);

            expect(await sut.getTotalShares(weth.target)).to.equal(totalSharesBefore - amount);
        });

        it("Should allow a remainder of 0", async function () {
            const { sut, wallets, weth, amounts } = await loadFixture(fixtureWithDeposit);

            const amount = amounts.weth;

            await sut.withdraw(weth.target, amount);

            expect(await sut.getTotalShares(weth.target)).to.equal(0n);
            expect(await sut.getUserShares(weth.target, wallets.deployer.address)).to.equal(0n);
        });

        it("Should send the value back to the user", async function () {
            const { sut, wallets, weth, settings } = await loadFixture(fixtureWithDeposit);

            const amount = settings.weth.minShareValue;

            const sutBalanceBefore = await weth.balanceOf(sut.target);
            const walletBalanceBefore = await weth.balanceOf(wallets.deployer.address);

            await sut.withdraw(weth.target, amount);

            expect(await weth.balanceOf(sut.target)).to.equal(sutBalanceBefore - amount);
            expect(await weth.balanceOf(wallets.deployer.address)).to.equal(walletBalanceBefore + amount);
        });

        it("Should emit LiquidityRemoved", async function () {
            const { sut, wallets, weth, settings } = await loadFixture(fixtureWithDeposit);

            const amount = settings.weth.minShareValue;
            const totalShares = await sut.getTotalShares(weth.target);

            await expect(sut.withdraw(weth.target, amount))
                .to.emit(sut, "LiquidityRemoved")
                .withArgs(wallets.deployer.address, weth.target, amount, totalShares - amount);
        });
    });

    describe("requestLiquidity", function () {
        it("Should revert if the caller is not an app", async function () {
            const { sut, weth, wallets } = await loadFixture(fixtureWithDeposit);

            await expect(sut.requestLiquidity(weth.target, oneEther))
                .to.be.revertedWithCustomError(sut, "AppNotEnabled")
                .withArgs(wallets.deployer.address);
        });

        it("Should revert if the token is not enabled", async function () {
            const { sut, app, blockedToken } = await loadFixture(fixtureWithDeposit);

            await expect(app.requestLiquidity(blockedToken.target, oneEther))
                .to.be.revertedWithCustomError(sut, "TokenNotEnabled")
                .withArgs(blockedToken.target);
        });

        it("Should revert if the amount exceeds the exposure limit", async function () {
            const { sut, app, weth } = await loadFixture(fixtureWithDeposit);

            const limit = await sut.getMaxExposure(weth.target);

            await expect(app.requestLiquidity(weth.target, limit + 1n)).to.be.revertedWithCustomError(
                sut,
                "MaxExposureExceeded"
            );
        });

        it("Should revert if the amount exceeds the available balance", async function () {
            const { sut, app, weth, settings, amounts } = await loadFixture(fixtureWithDeposit);

            await sut.setTokenSettings(weth.target, {
                ...settings.weth,
                maxExposureBPS: 11000,
            });

            await expect(app.requestLiquidity(weth.target, amounts.weth + 1n)).to.be.revertedWithCustomError(
                sut,
                "InsufficientLiquidity"
            );
        });

        it("Should revert if the amount exceeds the buffer limit", async function () {
            const { sut, app, weth, settings, amounts } = await loadFixture(fixtureWithDeposit);

            await sut.setTokenSettings(weth.target, {
                ...settings.weth,
                maxExposureBPS: 10000,
            });
            const bufferLimit = (amounts.weth * BigInt(settings.weth.bufferBPS)) / 10000n;

            const available = amounts.weth - bufferLimit;

            await expect(app.requestLiquidity(weth.target, available + 1n)).to.be.revertedWithCustomError(
                sut,
                "InsufficientLiquidity"
            );
        });

        it("Should create a hold request", async function () {
            const { sut, app, weth } = await loadFixture(fixtureWithDeposit);

            const amount = await sut.getMaxExposure(weth.target);
            await app.requestLiquidity(weth.target, amount);

            const request = await sut.getHoldRequest(weth.target, 0);

            expect(request.addr).to.equal(app.target);
            expect(request.value).to.equal(amount);
        });

        it("Should increment the token hold", async function () {
            const { sut, app, weth } = await loadFixture(fixtureWithDeposit);

            const amount = await sut.getMaxExposure(weth.target);
            await app.requestLiquidity(weth.target, amount);

            const hold = await sut.getOnHold(weth.target);

            expect(hold).to.equal(amount);
        });

        it("Should increment the next request id", async function () {
            const { sut, app, weth } = await loadFixture(fixtureWithDeposit);

            const amount = await sut.getMaxExposure(weth.target);
            await app.requestLiquidity(weth.target, amount);

            expect(await sut.getNextRequestId(weth.target)).to.equal(1);
        });

        it("Should send the token value to the app", async function () {
            const { sut, app, weth, amounts } = await loadFixture(fixtureWithDeposit);

            const amount = await sut.getMaxExposure(weth.target);
            await app.requestLiquidity(weth.target, amount);

            expect(await weth.balanceOf(app.target)).to.equal(amount);
            expect(await weth.balanceOf(sut.target)).to.equal(amounts.weth - amount);
        });

        it("Should emit LiquidityHoldPlaced", async function () {
            const { sut, app, weth } = await loadFixture(fixtureWithDeposit);

            const amount = await sut.getMaxExposure(weth.target);

            await expect(app.requestLiquidity(weth.target, amount))
                .to.emit(sut, "LiquidityHoldPlaced")
                .withArgs(app.target, weth.target, amount, 0n);
        });

        it("Should return the request id and amount", async function () {
            const { sut, app, weth } = await loadFixture(fixtureWithDeposit);

            const amount = await sut.getMaxExposure(weth.target);
            await expect(app.requestLiquidity(weth.target, amount))
                .to.emit(app, "LiquidityRequested")
                .withArgs(0n, amount);
        });

        describe("amount_ == 0", function () {
            it("Should use the max exposure amount", async function () {
                const { sut, app, weth } = await loadFixture(fixtureWithDeposit);

                const exposureAmount = await sut.getMaxExposure(weth.target);

                const amount = 0n;
                await app.requestLiquidity(weth.target, amount);

                const hold = await sut.getOnHold(weth.target);
                const request = await sut.getHoldRequest(weth.target, 0);

                expect(hold).to.equal(exposureAmount);
                expect(request.addr).to.equal(app.target);
                expect(request.value).to.equal(exposureAmount);
            });
        });
    });

    describe("settleLiquidityRequest", function () {
        it("Should revert if the hold value is 0", async function () {
            const { sut } = await loadFixture(fixture);
        });

        it("Should revert if the caller did not place the hold", async function () {
            const { sut } = await loadFixture(fixture);
        });

        it("Should clear the hold request", async function () {
            const { sut } = await loadFixture(fixture);
        });

        describe("incoming_ > 0", function () {
            it("Should send the fee to the gas fund", async function () {
                const { sut } = await loadFixture(fixture);
            });
        });

        describe("incoming_ == 0", function () {
            it("Should have no fee", async function () {
                const { sut } = await loadFixture(fixture);
            });
        });

        it("Should decrease the token hold", async function () {
            const { sut } = await loadFixture(fixture);
        });

        it("Should emit LiquidityHoldResolved", async function () {
            const { sut } = await loadFixture(fixture);
        });
    });

    describe("validateAndPayForPaymasterTransaction", function () {
        it("Should revert if the caller is not the bootloader", async function () {
            const { sut } = await loadFixture(fixture);
        });

        it("Should revert if the paymaster input is too short", async function () {
            const { sut } = await loadFixture(fixture);
        });

        it("Should revert if the paymaster input is not the general flow", async function () {
            const { sut } = await loadFixture(fixture);
        });

        it("Should set the context for a 1+ app with input > 4 bytes", async function () {
            // NOTE: This is a coverage only test, we cannot pull the value, just checking the line is hit without revert
            const { sut } = await loadFixture(fixture);
        });

        it("Should send ether to the bootloader", async function () {
            const { sut } = await loadFixture(fixture);
        });
    });

    describe("postTransaction", function () {
        it("Should revert if the caller is not the bootloader", async function () {
            const { sut } = await loadFixture(fixture);
        });

        it("Should emit GasSponsored for the min amount", async function () {
            const { sut } = await loadFixture(fixture);
        });

        describe("_context.length > 0", function () {
            describe("token == weth", function () {
                it("Should revert if there is insufficient weth", async function () {
                    const { sut } = await loadFixture(fixture);
                });

                it("Should withdraw the min amount weth", async function () {
                    const { sut } = await loadFixture(fixture);
                });

                it("Should emit GasLiquiditySponsored", async function () {
                    const { sut } = await loadFixture(fixture);
                });
            });

            describe("token != weth", function () {
                describe("exchangeRateNumerator > 0", function () {
                    it("Should revert if there is insufficient token", async function () {
                        const { sut } = await loadFixture(fixture);
                    });

                    it("Should send the exchanged token amount to the gas fund", async function () {
                        const { sut } = await loadFixture(fixture);
                    });

                    it("Should emit GasLiquiditySponsored", async function () {
                        const { sut } = await loadFixture(fixture);
                    });
                });

                describe("exchangeRateNumerator == 0", function () {
                    it("Should take no further action", async function () {
                        const { sut } = await loadFixture(fixture);
                    });
                });
            });
        });
    });

    describe("receive", function () {
        it("Should emit GasFunded", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            expect(
                await wallets.deployer.sendTransaction({
                    to: sut.target,
                    value: oneEther,
                })
            )
                .to.emit(sut, "GasFunded")
                .withArgs(oneEther);
        });
    });

    describe("_authorizeUpgrade", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            const IMPL = await ethers.getContractFactory("CrossAppLiquidityV1");
            const impl = await IMPL.deploy(
                wallets.oracle.address,
                wallets.gasFund.address,
                wallets.rewardFund.address,
                weth.target
            );
            await impl.waitForDeployment();

            await expect(sut.connect(wallets.user).upgradeToAndCall(impl.target, "0x")).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should allow the owner to upgrade", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            const IMPL = await ethers.getContractFactory("CrossAppLiquidityV1");
            const impl = await IMPL.deploy(
                wallets.user.address,
                wallets.gasFund.address,
                wallets.rewardFund.address,
                weth.target
            );
            await impl.waitForDeployment();

            await expect(sut.connect(wallets.deployer).upgradeToAndCall(impl.target, "0x")).to.not.be.reverted;

            expect(await sut.getOracle()).to.equal(wallets.user.address);
        });
    });
});
