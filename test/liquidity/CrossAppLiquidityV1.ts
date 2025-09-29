import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { BytesLike, hexlify, randomBytes } from "ethers";
import hre, { ethers } from "hardhat";
import { CrossAppLiquidityV1 } from "../../typechain-types";

const oneEther = ethers.parseEther("1");

const generalSelector = "0x8c5a3445"; // IPaymasterFlow.general.selector

function createDummyTransaction(
    from: string,
    to: string,
    paymasterInput: BytesLike = generalSelector,
    gasLimit: bigint = 200000n,
    maxFeePerGas: bigint = 10n
) {
    return {
        txType: 0n,
        from,
        to,
        gasLimit,
        gasPerPubdataByteLimit: oneEther,
        maxFeePerGas,
        maxPriorityFeePerGas: oneEther,
        paymaster: oneEther,
        nonce: oneEther,
        value: oneEther,
        reserved: [0n, 0n, 0n, 0n] as [bigint, bigint, bigint, bigint],
        data: "0x",
        signature: "0x",
        factoryDeps: [hexlify(randomBytes(32))],
        paymasterInput,
        reservedDynamic: "0x",
    };
}

describe("CrossAppLiquidityV1", function () {
    async function fixture() {
        const [deployer, gasFund, rewardFund, oracle, user, bank] = await ethers.getSigners();

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

        await app.enableToken(weth.target);
        await app.enableToken(allowedToken.target);

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

        await bank.sendTransaction({
            to: sut.target,
            value: oneEther * 100n,
        });

        await bank.sendTransaction({
            to: bootloader.address,
            value: oneEther * 100n,
        });

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

    async function fixtureWithRequest() {
        const data = await fixtureWithDeposit();

        const { sut, app, weth, allowedToken } = data;

        const maxWeth = await sut.getMaxExposure(weth.target);
        const maxToken = await sut.getMaxExposure(allowedToken.target);

        await app.requestLiquidity(weth.target, maxWeth);
        await app.requestLiquidity(allowedToken.target, maxToken);

        return {
            ...data,
            requests: [
                { token: weth.target, amount: maxWeth },
                { token: allowedToken.target, amount: maxToken },
            ],
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

    describe("getExchangeRateDenominator", function () {
        it("Should be 0.01 ether", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.getExchangeRateDenominator()).to.equal(ethers.parseEther("0.01"));
        });
    });

    describe("getTotalBalance", function () {
        it("Should be the sum of the token balance and hold", async function () {
            const { sut, weth, allowedToken } = await loadFixture(fixtureWithRequest);

            const wethHold = await sut.getOnHold(weth.target);
            const tokenHold = await sut.getOnHold(allowedToken.target);

            expect(wethHold).to.be.greaterThan(0n);
            expect(tokenHold).to.be.greaterThan(0n);

            const wethBalance = await weth.balanceOf(sut.target);
            const tokenBalance = await allowedToken.balanceOf(sut.target);

            expect(wethBalance).to.be.greaterThan(0n);
            expect(tokenBalance).to.be.greaterThan(0n);

            expect(await sut.getTotalBalance(weth.target)).to.equal(wethBalance + wethHold);
            expect(await sut.getTotalBalance(allowedToken.target)).to.equal(tokenBalance + tokenHold);
        });
    });

    describe("getTokenData", function () {
        it("Should return an empty array", async function () {
            const { sut, wallets } = await loadFixture(fixtureWithRequest);

            expect(await sut.getTokenData([])).to.deep.equal([]);
        });

        it("Should return detailed token information", async function () {
            const { sut, weth, allowedToken, blockedToken, wallets, settings, amounts, requests } =
                await loadFixture(fixtureWithRequest);

            const exposure = (amount: bigint, bps: number) => (amount * BigInt(bps)) / 10000n;

            const allowedRate = oneEther;
            await sut.connect(wallets.oracle).setExchangeRate(allowedToken.target, allowedRate);

            const data = await sut.getTokenData([weth.target, allowedToken.target, blockedToken.target]);

            expect(data.length).to.equal(3);

            expect(data[0].token).to.equal(weth.target);
            expect(data[0].totalShares).to.equal(amounts.weth);
            expect(data[0].totalBalance).to.equal(amounts.weth);
            expect(data[0].availableBalance).to.equal(amounts.weth - requests[0].amount);
            expect(data[0].exchangeRate).to.equal(0n);
            expect(data[0].maxExposure).to.equal(exposure(amounts.weth, settings.weth.maxExposureBPS));
            expect(data[0].settings.enabled).to.equal(settings.weth.enabled);
            expect(data[0].settings.feeBPS).to.equal(settings.weth.feeBPS);
            expect(data[0].settings.bufferBPS).to.equal(settings.weth.bufferBPS);
            expect(data[0].settings.maxExposureBPS).to.equal(settings.weth.maxExposureBPS);
            expect(data[0].settings.minShareValue).to.equal(settings.weth.minShareValue);

            expect(data[1].token).to.equal(allowedToken.target);
            expect(data[1].totalShares).to.equal(amounts.token);
            expect(data[1].totalBalance).to.equal(amounts.token);
            expect(data[1].availableBalance).to.equal(amounts.token - requests[1].amount);
            expect(data[1].exchangeRate).to.equal(allowedRate);
            expect(data[1].maxExposure).to.equal(exposure(amounts.token, settings.allowedToken.maxExposureBPS));
            expect(data[1].settings.enabled).to.equal(settings.allowedToken.enabled);
            expect(data[1].settings.feeBPS).to.equal(settings.allowedToken.feeBPS);
            expect(data[1].settings.bufferBPS).to.equal(settings.allowedToken.bufferBPS);
            expect(data[1].settings.maxExposureBPS).to.equal(settings.allowedToken.maxExposureBPS);
            expect(data[1].settings.minShareValue).to.equal(settings.allowedToken.minShareValue);

            expect(data[2].token).to.equal(blockedToken.target);
            expect(data[2].totalShares).to.equal(0n);
            expect(data[2].totalBalance).to.equal(0n);
            expect(data[2].availableBalance).to.equal(0n);
            expect(data[2].exchangeRate).to.equal(0n);
            expect(data[2].maxExposure).to.equal(0n);
            expect(data[2].settings.enabled).to.equal(false);
            expect(data[2].settings.feeBPS).to.equal(0n);
            expect(data[2].settings.bufferBPS).to.equal(0n);
            expect(data[2].settings.maxExposureBPS).to.equal(0n);
            expect(data[2].settings.minShareValue).to.equal(0n);
        });
    });

    describe("getUserTokenData", function () {
        it("Should return an empty array", async function () {
            const { sut, wallets } = await loadFixture(fixtureWithRequest);

            expect(await sut.getUserTokenData(wallets.user.address, [])).to.deep.equal([]);
        });

        it("Should return detailed user token information", async function () {
            const { sut, weth, allowedToken, blockedToken, wallets, amounts } = await loadFixture(fixtureWithRequest);

            const data = await sut.getUserTokenData(wallets.deployer.address, [
                weth.target,
                allowedToken.target,
                blockedToken.target,
            ]);

            expect(data.length).to.equal(3);

            expect(data[0].token).to.equal(weth.target);
            expect(data[0].shares).to.equal(amounts.weth);
            expect(data[0].shareValue).to.equal(amounts.weth);

            expect(data[1].token).to.equal(allowedToken.target);
            expect(data[1].shares).to.equal(amounts.token);
            expect(data[1].shareValue).to.equal(amounts.token);

            expect(data[2].token).to.equal(blockedToken.target);
            expect(data[2].shares).to.equal(0n);
            expect(data[2].shareValue).to.equal(0n);
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
            const impl = await IMPL.deploy(wallets.user.address, app.target, wallets.rewardFund.address, weth.target);
            await impl.waitForDeployment();

            await sut.connect(wallets.deployer).upgradeToAndCall(impl.target, "0x");

            await wallets.deployer.sendTransaction({ to: sut.target, value: oneEther });

            await expect(sut.withdrawGas(oneEther)).to.be.revertedWithCustomError(sut, "FailedToTransferEther");
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

            const balance = await ethers.provider.getBalance(sut.target);
            await wallets.deployer.sendTransaction({ to: sut.target, value: oneEther });

            await expect(sut.connect(wallets.user).withdrawAllGas()).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if sending the ether to a contract that cannot receive", async function () {
            const { sut, weth, app, wallets } = await loadFixture(fixture);

            const IMPL = await ethers.getContractFactory("CrossAppLiquidityV1");
            const impl = await IMPL.deploy(wallets.user.address, app.target, wallets.rewardFund.address, weth.target);
            await impl.waitForDeployment();

            await sut.connect(wallets.deployer).upgradeToAndCall(impl.target, "0x");

            await wallets.deployer.sendTransaction({ to: sut.target, value: oneEther });

            await expect(sut.withdrawAllGas()).to.be.revertedWithCustomError(sut, "FailedToTransferEther");
        });

        it("Should send the entire eth balance to the gas fund", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await wallets.deployer.sendTransaction({ to: sut.target, value: oneEther });

            const sutBalance = await ethers.provider.getBalance(sut.target);
            const gasFundBalance = await ethers.provider.getBalance(wallets.gasFund.address);

            await sut.withdrawAllGas();

            expect(await ethers.provider.getBalance(sut.target)).to.equal(0n);
            expect(await ethers.provider.getBalance(wallets.gasFund.address)).to.equal(sutBalance + gasFundBalance);
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
            expect(await sut.getUserShareValue(weth.target, wallets.user.address)).to.equal(amount);
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

            expect(userShares).to.equal(amount1);
            expect(deployerShares).to.equal(amount2);

            expect(await sut.getUserShareValue(weth.target, wallets.user.address)).to.equal(amount1);
            expect(await sut.getUserShareValue(weth.target, wallets.deployer.address)).to.equal(amount2);

            expect(await sut.getTotalShares(weth.target)).to.equal(userShares + deployerShares);
        });

        it("Should account for hold balance", async function () {
            const { sut, app, weth, settings, wallets } = await loadFixture(fixture);

            const amount1 = settings.weth.minShareValue * 10n;
            const amount2 = settings.weth.minShareValue * 20n;

            await sut.connect(wallets.user).deposit(weth.target, 0n, {
                value: amount1,
            });

            const requestedToken = await sut.getMaxExposure(weth.target);
            await app.requestLiquidity(weth.target, requestedToken);

            await sut.connect(wallets.deployer).deposit(weth.target, 0n, {
                value: amount2,
            });

            const userShares = await sut.getUserShares(weth.target, wallets.user.address);
            const deployerShares = await sut.getUserShares(weth.target, wallets.deployer.address);

            const totalShares = await sut.getTotalShares(weth.target);
            const hold = await sut.getOnHold(weth.target);

            expect(requestedToken).to.be.greaterThan(0n);
            expect(hold).to.equal(requestedToken);
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

        it("Should revert if the withdraw amount is greater than the available balance", async function () {
            const { sut, weth, app, amounts } = await loadFixture(fixtureWithDeposit);

            const exposure = await sut.getMaxExposure(weth.target);
            await app.requestLiquidity(weth.target, exposure);

            await expect(sut.withdraw(weth.target, amounts.weth)).to.be.revertedWithCustomError(
                sut,
                "InsufficientLiquidity"
            );
        });

        it("Should update the users shares", async function () {
            const { sut, wallets, weth, settings } = await loadFixture(fixtureWithDeposit);

            const amount = settings.weth.minShareValue;
            const sharesBefore = await sut.getUserShares(weth.target, wallets.deployer.address);

            await sut.withdraw(weth.target, amount);

            expect(await sut.getUserShares(weth.target, wallets.deployer.address)).to.equal(sharesBefore - amount);
            expect(await sut.getUserShareValue(weth.target, wallets.deployer.address)).to.equal(sharesBefore - amount);
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
            expect(await sut.getUserShareValue(weth.target, wallets.deployer.address)).to.equal(0n);
        });

        it("Should account for hold balance", async function () {
            const { sut, weth, app, wallets, settings, amounts } = await loadFixture(fixtureWithDeposit);

            await sut.setTokenSettings(weth.target, {
                ...settings.weth,
                minShareValue: 0n,
            });

            const exposure = await sut.getMaxExposure(weth.target);
            await app.requestLiquidity(weth.target, exposure);

            const available = amounts.weth - exposure;

            await sut.withdraw(weth.target, available);

            expect(await sut.getOnHold(weth.target)).to.equal(exposure);
            expect(await weth.balanceOf(sut.target)).to.equal(0n);
            expect(await weth.balanceOf(app.target)).to.equal(exposure);
            expect(await weth.balanceOf(wallets.deployer.address)).to.equal(available);

            expect(await sut.getTotalShares(weth.target)).to.equal(exposure);
            expect(await sut.getUserShares(weth.target, wallets.deployer.address)).to.equal(exposure);
            expect(await sut.getUserShareValue(weth.target, wallets.deployer.address)).to.equal(exposure);
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

        it("Should set exposure limit accounting for hold", async function () {
            const { sut, app, weth } = await loadFixture(fixtureWithDeposit);

            const limit = await sut.getMaxExposure(weth.target);

            await expect(app.requestLiquidity(weth.target, limit)).to.not.be.reverted;

            await expect(app.requestLiquidity(weth.target, limit + 1n)).to.be.revertedWithCustomError(
                sut,
                "MaxExposureExceeded"
            );

            await expect(app.requestLiquidity(weth.target, limit)).to.not.be.reverted;
        });

        it("Should set buffer limit account for hold", async function () {
            const { sut, app, weth, settings, amounts } = await loadFixture(fixtureWithDeposit);

            await sut.setTokenSettings(weth.target, {
                ...settings.weth,
                maxExposureBPS: 10000,
            });

            const hold = amounts.weth - amounts.weth / 10n;
            await expect(app.requestLiquidity(weth.target, hold)).to.not.be.reverted;

            const bufferLimit = (amounts.weth * BigInt(settings.weth.bufferBPS)) / 10000n;

            const available = amounts.weth - bufferLimit - hold;
            expect(await sut.getAvailableBalance(weth.target)).to.be.greaterThan(available + 1n);
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
            const { sut, app, weth } = await loadFixture(fixtureWithRequest);

            await expect(app.settleLiquidityRequest(1, weth.target, 0n, 0n)).to.be.revertedWithCustomError(
                sut,
                "HoldNotFound"
            );
        });

        it("Should revert if the caller did not place the hold", async function () {
            const { sut, weth } = await loadFixture(fixtureWithRequest);

            await expect(sut.settleLiquidityRequest(0, weth.target, 0n, 0n)).to.be.revertedWithCustomError(
                sut,
                "HoldNotFound"
            );
        });

        it("Should clear the hold request", async function () {
            const { sut, app, weth } = await loadFixture(fixtureWithRequest);

            await app.settleLiquidityRequest(0, weth.target, 0n, 0n);

            const request = await sut.getHoldRequest(weth.target, 0);
            expect(request.addr).to.equal(ethers.ZeroAddress);
            expect(request.value).to.equal(0n);
        });

        describe("incoming_ > 0", function () {
            it("Should send the fee to the gas fund", async function () {
                const { app, weth, wallets, settings } = await loadFixture(fixtureWithRequest);

                const incoming = oneEther;
                await weth.deposit({ value: incoming });
                await weth.transfer(app.target, incoming);

                const fee = (incoming * BigInt(settings.weth.feeBPS)) / 10000n;

                const gasFundBalanceBefore = await weth.balanceOf(wallets.gasFund.address);
                await app.settleLiquidityRequest(0, weth.target, incoming, 0n);
                const gasFundBalanceAfter = await weth.balanceOf(wallets.gasFund.address);

                expect(gasFundBalanceAfter - gasFundBalanceBefore).to.equal(fee);
            });

            it("Should transfer the token from the app to the LP", async function () {
                const { sut, app, weth, settings } = await loadFixture(fixtureWithRequest);

                const incoming = oneEther;
                const outgoing = oneEther / 2n;
                await weth.deposit({ value: incoming });
                await weth.transfer(app.target, incoming);

                const fee = (incoming * BigInt(settings.weth.feeBPS)) / 10000n;
                const request = await sut.getHoldRequest(weth.target, 0);

                const appBalanceBefore = await weth.balanceOf(app.target);
                const sutBalanceBefore = await weth.balanceOf(sut.target);

                await app.settleLiquidityRequest(0, weth.target, incoming, outgoing);

                const appBalanceAfter = await weth.balanceOf(app.target);
                const sutBalanceAfter = await weth.balanceOf(sut.target);

                const transferred = incoming + request.value - outgoing;

                expect(appBalanceBefore - appBalanceAfter).to.equal(transferred);
                expect(sutBalanceAfter - sutBalanceBefore).to.equal(transferred - fee);
            });
        });

        describe("incoming_ == 0", function () {
            it("Should have no fee", async function () {
                const { app, weth, wallets } = await loadFixture(fixtureWithRequest);

                await weth.deposit({ value: oneEther });
                await weth.transfer(app.target, oneEther);

                const gasFundBalanceBefore = await weth.balanceOf(wallets.gasFund.address);
                await app.settleLiquidityRequest(0, weth.target, 0n, 0n);
                const gasFundBalanceAfter = await weth.balanceOf(wallets.gasFund.address);

                expect(gasFundBalanceAfter - gasFundBalanceBefore).to.equal(0n);
            });

            it("Should transfer the token from the app to the LP", async function () {
                const { sut, app, weth } = await loadFixture(fixtureWithRequest);

                const request = await sut.getHoldRequest(weth.target, 0);
                const appBalanceBefore = await weth.balanceOf(app.target);
                const sutBalanceBefore = await weth.balanceOf(sut.target);

                await app.settleLiquidityRequest(0, weth.target, 0n, 0n);

                const appBalanceAfter = await weth.balanceOf(app.target);
                const sutBalanceAfter = await weth.balanceOf(sut.target);

                expect(appBalanceBefore - appBalanceAfter).to.equal(request.value);
                expect(sutBalanceAfter - sutBalanceBefore).to.equal(request.value);
            });
        });

        it("Should decrease the token hold", async function () {
            const { sut, app, weth, requests } = await loadFixture(fixtureWithRequest);

            expect(await sut.getOnHold(weth.target)).to.equal(requests[0].amount);

            await app.settleLiquidityRequest(0, weth.target, 0n, 0n);

            expect(await sut.getOnHold(weth.target)).to.equal(0n);
        });

        it("Should emit LiquidityHoldResolved", async function () {
            const { sut, app, weth, settings } = await loadFixture(fixtureWithRequest);

            const requestId = 0n;

            const incoming = oneEther;
            const outGoing = oneEther / 2n;

            await weth.deposit({ value: incoming });
            await weth.transfer(app.target, incoming);

            const fee = (incoming * BigInt(settings.weth.feeBPS)) / 10000n;

            await expect(app.settleLiquidityRequest(requestId, weth.target, incoming, outGoing))
                .to.emit(sut, "LiquidityHoldResolved")
                .withArgs(app.target, weth.target, requestId, incoming, outGoing, fee);
        });
    });

    describe("validateAndPayForPaymasterTransaction", function () {
        it("Should revert if the caller is not the bootloader", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const hash = hexlify(randomBytes(32));
            const suggestedHash = hexlify(randomBytes(32));
            const transaction = createDummyTransaction(wallets.deployer.address, wallets.user.address);

            await expect(
                sut.connect(wallets.deployer).validateAndPayForPaymasterTransaction(hash, suggestedHash, transaction)
            ).to.be.revertedWithCustomError(sut, "NotBootloader");
        });

        it("Should revert if the paymaster input is too short", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const hash = hexlify(randomBytes(32));
            const suggestedHash = hexlify(randomBytes(32));
            const transaction = createDummyTransaction(wallets.deployer.address, wallets.user.address, "0x8c5a34");

            await expect(
                sut.connect(wallets.bootloader).validateAndPayForPaymasterTransaction(hash, suggestedHash, transaction)
            ).to.be.revertedWithCustomError(sut, "InvalidPaymasterInput");
        });

        it("Should revert if the paymaster input is not the general flow", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const hash = hexlify(randomBytes(32));
            const suggestedHash = hexlify(randomBytes(32));
            const transaction = createDummyTransaction(wallets.deployer.address, wallets.user.address, "0x8c5a3446");

            await expect(
                sut.connect(wallets.bootloader).validateAndPayForPaymasterTransaction(hash, suggestedHash, transaction)
            ).to.be.revertedWithCustomError(sut, "InvalidPaymasterInput");
        });

        it("Should set the context for a 1+ app with input > 4 bytes", async function () {
            // NOTE: This is a coverage only test, we cannot pull the value, just checking the line is hit without revert
            const { sut, app, wallets } = await loadFixture(fixture);

            const input = generalSelector + "ffff";

            const hash = hexlify(randomBytes(32));
            const suggestedHash = hexlify(randomBytes(32));
            const transaction = createDummyTransaction(wallets.user.address, await app.getAddress(), input);

            await expect(
                sut.connect(wallets.bootloader).validateAndPayForPaymasterTransaction(hash, suggestedHash, transaction)
            ).to.not.be.reverted;
        });

        it("Should send ether to the bootloader", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const bootloaderBalanceBefore = await ethers.provider.getBalance(wallets.bootloader.address);
            const sutBalanceBefore = await ethers.provider.getBalance(sut.target);

            const gasLimit = 200000n;
            const maxFeePerGas = 10n;

            const hash = hexlify(randomBytes(32));
            const suggestedHash = hexlify(randomBytes(32));
            const transaction = createDummyTransaction(
                wallets.deployer.address,
                wallets.user.address,
                generalSelector,
                gasLimit,
                maxFeePerGas
            );

            const tx = await sut
                .connect(wallets.bootloader)
                .validateAndPayForPaymasterTransaction(hash, suggestedHash, transaction);
            const receipt = await tx.wait();

            if (!receipt) {
                throw new Error("Transaction receipt is null");
            }

            const gasSpent = receipt.gasUsed * receipt.gasPrice;

            const expectedTransfer = gasLimit * maxFeePerGas;

            expect(await ethers.provider.getBalance(wallets.bootloader.address)).to.equal(
                bootloaderBalanceBefore + expectedTransfer - gasSpent
            );

            expect(await ethers.provider.getBalance(sut.target)).to.equal(sutBalanceBefore - expectedTransfer);
        });
    });

    describe("postTransaction", function () {
        const gasLimit = 200000n;
        const maxRefundedGas = 100000n;
        const maxFeePerGas = 10n;
        const hash = hexlify(randomBytes(32));
        const suggestedHash = hexlify(randomBytes(32));
        const txResult = 1;

        it("Should revert if the caller is not the bootloader", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const context = "0x";
            const transaction = createDummyTransaction(wallets.user.address, await sut.getAddress());
            const maxRefundedGas = oneEther;

            await expect(
                sut
                    .connect(wallets.user)
                    .postTransaction(context, transaction, hash, suggestedHash, txResult, maxRefundedGas)
            ).to.be.revertedWithCustomError(sut, "NotBootloader");
        });

        it("Should emit GasSponsored for the min amount", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const context = "0x";
            const transaction = createDummyTransaction(
                wallets.deployer.address,
                wallets.user.address,
                generalSelector,
                gasLimit,
                maxFeePerGas
            );

            await expect(
                sut
                    .connect(wallets.bootloader)
                    .postTransaction(context, transaction, hash, suggestedHash, txResult, maxRefundedGas)
            )
                .to.emit(sut, "GasSponsored")
                .withArgs(wallets.user.address, wallets.deployer.address, (gasLimit - maxRefundedGas) * maxFeePerGas);
        });

        describe("_context.length > 0", function () {
            describe("token == weth", function () {
                it("Should revert if there is insufficient weth", async function () {
                    const { sut, weth, wallets } = await loadFixture(fixture);

                    const context = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [weth.target]);
                    const transaction = createDummyTransaction(
                        wallets.deployer.address,
                        wallets.user.address,
                        generalSelector,
                        gasLimit,
                        maxFeePerGas
                    );

                    await expect(
                        sut
                            .connect(wallets.bootloader)
                            .postTransaction(context, transaction, hash, suggestedHash, txResult, maxRefundedGas)
                    ).to.be.reverted;
                });

                it("Should withdraw the min amount weth", async function () {
                    const { sut, weth, wallets } = await loadFixture(fixture);

                    const minAmount = (gasLimit - maxRefundedGas) * maxFeePerGas;
                    await weth.deposit({ value: minAmount });
                    await weth.transfer(sut.target, minAmount);

                    const context = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [weth.target]);
                    const transaction = createDummyTransaction(
                        wallets.deployer.address,
                        wallets.user.address,
                        generalSelector,
                        gasLimit,
                        maxFeePerGas
                    );

                    const ethBalanceBefore = await ethers.provider.getBalance(sut.target);
                    const wethBalanceBefore = await weth.balanceOf(sut.target);

                    await sut
                        .connect(wallets.bootloader)
                        .postTransaction(context, transaction, hash, suggestedHash, txResult, maxRefundedGas);

                    expect(await ethers.provider.getBalance(sut.target)).to.equal(ethBalanceBefore + minAmount);
                    expect(await weth.balanceOf(sut.target)).to.equal(wethBalanceBefore - minAmount);
                });

                it("Should emit GasLiquiditySponsored", async function () {
                    const { sut, weth, wallets } = await loadFixture(fixture);

                    const minAmount = (gasLimit - maxRefundedGas) * maxFeePerGas;
                    await weth.deposit({ value: minAmount });
                    await weth.transfer(sut.target, minAmount);

                    const context = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [weth.target]);
                    const transaction = createDummyTransaction(
                        wallets.deployer.address,
                        wallets.user.address,
                        generalSelector,
                        gasLimit,
                        maxFeePerGas
                    );

                    await expect(
                        sut
                            .connect(wallets.bootloader)
                            .postTransaction(context, transaction, hash, suggestedHash, txResult, maxRefundedGas)
                    )
                        .to.emit(sut, "GasLiquiditySponsored")
                        .withArgs(wallets.user.address, wallets.deployer.address, weth.target, minAmount);
                });
            });

            describe("token != weth", function () {
                describe("exchangeRateNumerator > 0", function () {
                    it("Should revert if there is insufficient token", async function () {
                        const { sut, allowedToken, wallets } = await loadFixture(fixture);

                        await sut.connect(wallets.oracle).setExchangeRate(allowedToken.target, oneEther); // 100:1

                        const context = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [allowedToken.target]);
                        const transaction = createDummyTransaction(
                            wallets.deployer.address,
                            wallets.user.address,
                            generalSelector,
                            gasLimit,
                            maxFeePerGas
                        );

                        await expect(
                            sut
                                .connect(wallets.bootloader)
                                .postTransaction(context, transaction, hash, suggestedHash, txResult, maxRefundedGas)
                        ).to.be.revertedWithCustomError(allowedToken, "ERC20InsufficientBalance");
                    });

                    it("Should send the exchanged token amount to the gas fund", async function () {
                        const { sut, allowedToken, wallets } = await loadFixture(fixture);

                        await sut.connect(wallets.oracle).setExchangeRate(allowedToken.target, oneEther); // 100:1

                        const minAmount = (gasLimit - maxRefundedGas) * maxFeePerGas * 100n;
                        await allowedToken.mint(wallets.deployer.address, minAmount);
                        await allowedToken.transfer(sut.target, minAmount);

                        const context = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [allowedToken.target]);
                        const transaction = createDummyTransaction(
                            wallets.deployer.address,
                            wallets.user.address,
                            generalSelector,
                            gasLimit,
                            maxFeePerGas
                        );

                        const gasFundBalanceBefore = await allowedToken.balanceOf(wallets.gasFund.address);
                        const sutBalanceBefore = await allowedToken.balanceOf(sut.target);

                        await sut
                            .connect(wallets.bootloader)
                            .postTransaction(context, transaction, hash, suggestedHash, txResult, maxRefundedGas);

                        expect(await allowedToken.balanceOf(wallets.gasFund.address)).to.equal(
                            gasFundBalanceBefore + minAmount
                        );
                        expect(await allowedToken.balanceOf(sut.target)).to.equal(sutBalanceBefore - minAmount);
                    });

                    it("Should emit GasLiquiditySponsored", async function () {
                        const { sut, allowedToken, wallets } = await loadFixture(fixture);

                        await sut.connect(wallets.oracle).setExchangeRate(allowedToken.target, oneEther); // 100:1

                        const minAmount = (gasLimit - maxRefundedGas) * maxFeePerGas * 100n;
                        await allowedToken.mint(wallets.deployer.address, minAmount);
                        await allowedToken.transfer(sut.target, minAmount);

                        const context = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [allowedToken.target]);
                        const transaction = createDummyTransaction(
                            wallets.deployer.address,
                            wallets.user.address,
                            generalSelector,
                            gasLimit,
                            maxFeePerGas
                        );

                        await expect(
                            sut
                                .connect(wallets.bootloader)
                                .postTransaction(context, transaction, hash, suggestedHash, txResult, maxRefundedGas)
                        )
                            .to.emit(sut, "GasLiquiditySponsored")
                            .withArgs(wallets.user.address, wallets.deployer.address, allowedToken.target, minAmount);
                    });
                });

                describe("exchangeRateNumerator == 0", function () {
                    it("Should take no further action", async function () {
                        const { sut, allowedToken, wallets } = await loadFixture(fixture);

                        await sut.connect(wallets.oracle).setExchangeRate(allowedToken.target, 0n);

                        const minAmount = (gasLimit - maxRefundedGas) * maxFeePerGas * 100n;
                        await allowedToken.mint(wallets.deployer.address, minAmount);
                        await allowedToken.transfer(sut.target, minAmount);

                        const context = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [allowedToken.target]);
                        const transaction = createDummyTransaction(
                            wallets.deployer.address,
                            wallets.user.address,
                            generalSelector,
                            gasLimit,
                            maxFeePerGas
                        );

                        await expect(
                            sut
                                .connect(wallets.bootloader)
                                .postTransaction(context, transaction, hash, suggestedHash, txResult, maxRefundedGas)
                        ).to.not.emit(sut, "GasLiquiditySponsored");
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
