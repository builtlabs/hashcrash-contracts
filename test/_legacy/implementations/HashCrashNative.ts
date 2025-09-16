import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { id } from "ethers";
import { ethers } from "hardhat";

const maxExposureNumerator = 1000;
const lowLiquidityThreshold = ethers.parseEther("0.1");
const minimumValue = ethers.parseEther("0.01");

function getHash(salt: string) {
    return ethers.keccak256(ethers.solidityPacked(["bytes32"], [salt]));
}

describe("HashCrashNative", function () {
    async function fixture() {
        const [deployer] = await ethers.getSigners();

        const genesisSalt = ethers.hexlify(ethers.randomBytes(32));

        const WETH = await ethers.getContractFactory("WETH9");
        const weth = await WETH.deploy();
        await weth.waitForDeployment();

        const FixedRTP10x = await ethers.getContractFactory("FixedRTP10x");
        const lootTable = await FixedRTP10x.deploy();
        await lootTable.waitForDeployment();

        const HASHCRASH = await ethers.getContractFactory("HashCrashNative");
        const sut = await HASHCRASH.deploy(
            lootTable.target,
            getHash(genesisSalt),
            deployer.address,
            maxExposureNumerator,
            lowLiquidityThreshold,
            deployer.address,
            weth.target,
            minimumValue
        );
        await sut.waitForDeployment();

        return {
            sut,
            weth,
            lootTable,
            wallets: {
                deployer,
            },
            config: {
                introBlocks: 20,
                genesisSalt,
                genesisHash: getHash(genesisSalt),
                hashProducer: deployer.address,
                owner: deployer.address,
            },
        };
    }

    describe("constructor", function () {
        it("Should set the owner address", async function () {
            const { sut, config } = await loadFixture(fixture);

            expect(await sut.owner()).to.equal(config.owner);
        });

        it("Should set the low liquidity threshold", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.getLowLiquidityThreshold()).to.equal(lowLiquidityThreshold);
        });

        it("Should set the minimum value", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.getMinimum()).to.equal(minimumValue);
        });

        it("Should set active to false", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.getActive()).to.equal(false);
        });

        it("Should set the intro blocks to 20", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.getIntroBlocks()).to.equal(20);
        });

        it("Should set the reduced intro blocks to 5", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.getReducedIntroBlocks()).to.equal(5);
        });

        it("Should set the cancel return to 9700 (97%)", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.getCancelReturnNumerator()).to.equal(9700);
        });

        it("Should set the genesis hash", async function () {
            const { sut, config } = await loadFixture(fixture);

            expect(await sut.getRoundHash()).to.equal(config.genesisHash);
        });

        it("Should set the hash producer", async function () {
            const { sut, config } = await loadFixture(fixture);

            expect(await sut.getHashProducer()).to.equal(config.hashProducer);
        });

        it("Should set the loot table", async function () {
            const { sut, lootTable } = await loadFixture(fixture);

            expect(await sut.getLootTable()).to.equal(lootTable.target);
        });

        it("Should revert if the hash is zero", async function () {
            const { weth, lootTable, config } = await loadFixture(fixture);

            const SUT = await ethers.getContractFactory("HashCrashNative");

            await expect(
                SUT.deploy(
                    lootTable.target,
                    ethers.ZeroHash,
                    config.hashProducer,
                    maxExposureNumerator,
                    lowLiquidityThreshold,
                    config.owner,
                    weth.target,
                    minimumValue
                )
            )
                .to.be.revertedWithCustomError(SUT, "InvalidBytes")
                .withArgs(ethers.ZeroHash);
        });

        it("Should revert if the loot table address is zero", async function () {
            const { weth, config } = await loadFixture(fixture);

            const SUT = await ethers.getContractFactory("HashCrashNative");

            await expect(
                SUT.deploy(
                    ethers.ZeroAddress,
                    config.genesisHash,
                    config.hashProducer,
                    maxExposureNumerator,
                    lowLiquidityThreshold,
                    config.owner,
                    weth.target,
                    minimumValue
                )
            )
                .to.be.revertedWithCustomError(SUT, "InvalidAddress")
                .withArgs(ethers.ZeroAddress);
        });

        it("Should emit setup events", async function () {
            const { weth, lootTable, config } = await loadFixture(fixture);

            const HASHCRASH = await ethers.getContractFactory("HashCrashNative");
            const tx = await HASHCRASH.deploy(
                lootTable.target,
                config.genesisHash,
                config.hashProducer,
                maxExposureNumerator,
                lowLiquidityThreshold,
                config.owner,
                weth.target,
                minimumValue
            );
            const receipt = (await tx.deploymentTransaction()!.wait())!;

            const iface = HASHCRASH.interface;

            expect(
                receipt.logs
                    .filter((log) => log.topics[0] === id("LootTableUpdated(address)"))
                    .map((log) => iface.decodeEventLog("LootTableUpdated", log.data, log.topics))
            ).to.deep.include.members([[lootTable.target]]);

            expect(
                receipt.logs
                    .filter((log) => log.topics[0] === id("HashProducerUpdated(address)"))
                    .map((log) => iface.decodeEventLog("HashProducerUpdated", log.data, log.topics))
            ).to.deep.include.members([[config.hashProducer]]);

            expect(
                receipt.logs
                    .filter((log) => log.topics[0] === id("IntroBlocksUpdated(uint64)"))
                    .map((log) => iface.decodeEventLog("IntroBlocksUpdated", log.data, log.topics))
            ).to.deep.include.members([[20n]]);

            expect(
                receipt.logs
                    .filter((log) => log.topics[0] === id("ReducedIntroBlocksUpdated(uint32)"))
                    .map((log) => iface.decodeEventLog("ReducedIntroBlocksUpdated", log.data, log.topics))
            ).to.deep.include.members([[5n]]);

            expect(
                receipt.logs
                    .filter((log) => log.topics[0] === id("CancelReturnNumeratorUpdated(uint32)"))
                    .map((log) => iface.decodeEventLog("CancelReturnNumeratorUpdated", log.data, log.topics))
            ).to.deep.include.members([[9700n]]);
        });
    });

    describe("placeBet", function () {
        it("Should allow eth only", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await sut.deposit(0n, {
                value: ethers.parseEther("100"),
            });
            await sut.setActive(true);

            const nativeAmount = ethers.parseEther("0.1");

            const index = 10n;

            await sut.placeBet(0n, 10n, {
                value: nativeAmount,
            });

            const bet = await sut.getBet(0n);
            expect(bet.user).to.equal(wallets.deployer.address);
            expect(bet.amount).to.equal(nativeAmount);
            expect(bet.cancelled).to.equal(false);
            expect(bet.cashoutIndex).to.equal(index);
        });

        it("Should allow weth only", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            await sut.deposit(0n, {
                value: ethers.parseEther("100"),
            });
            await sut.setActive(true);

            const wethAmount = ethers.parseEther("0.1");
            await weth.deposit({
                value: wethAmount,
            });
            await weth.approve(sut.target, wethAmount);

            const index = 10n;

            await sut.placeBet(wethAmount, 10n);

            const bet = await sut.getBet(0n);
            expect(bet.user).to.equal(wallets.deployer.address);
            expect(bet.amount).to.equal(wethAmount);
            expect(bet.cancelled).to.equal(false);
            expect(bet.cashoutIndex).to.equal(index);
        });

        it("Should allow a mixture", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            await sut.deposit(0n, {
                value: ethers.parseEther("100"),
            });
            await sut.setActive(true);

            const nativeAmount = ethers.parseEther("0.1");

            const wethAmount = ethers.parseEther("0.2");
            await weth.deposit({
                value: wethAmount,
            });
            await weth.approve(sut.target, wethAmount);

            const index = 10n;

            await sut.placeBet(wethAmount, 10n, {
                value: nativeAmount,
            });

            const bet = await sut.getBet(0n);
            expect(bet.user).to.equal(wallets.deployer.address);
            expect(bet.amount).to.equal(nativeAmount + wethAmount);
            expect(bet.cancelled).to.equal(false);
            expect(bet.cashoutIndex).to.equal(index);
        });
    });

    describe("deposit", function () {
        it("Should allow eth only", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const nativeAmount = ethers.parseEther("0.1");

            await sut.deposit(0n, {
                value: nativeAmount,
            });

            const shares = await sut.getUserShares(wallets.deployer.address);
            expect(shares).to.equal(nativeAmount);
        });

        it("Should allow weth only", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            const wethAmount = ethers.parseEther("0.1");
            await weth.deposit({
                value: wethAmount,
            });
            await weth.approve(sut.target, wethAmount);

            await sut.deposit(wethAmount);

            const shares = await sut.getUserShares(wallets.deployer.address);
            expect(shares).to.equal(wethAmount);
        });

        it("Should allow a mixture", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            const nativeAmount = ethers.parseEther("0.1");

            const wethAmount = ethers.parseEther("0.2");
            await weth.deposit({
                value: wethAmount,
            });
            await weth.approve(sut.target, wethAmount);

            await sut.deposit(wethAmount, {
                value: nativeAmount,
            });

            const shares = await sut.getUserShares(wallets.deployer.address);
            expect(shares).to.equal(nativeAmount + wethAmount);
        });
    });
});
