import { loadFixture, mine } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { id } from "ethers";

const maxExposureNumerator = 1000n;
const lowLiquidityThreshold = ethers.parseEther("0.1");
const minimumValue = ethers.parseEther("0.001");
const initialBalance = ethers.parseEther("1000");
const oneEther = ethers.parseEther("1");

const _MAX_BET_QUEUE_SIZE = 256n;
const _MAX_LIQUIDITY_QUEUE_SIZE = 64n;

function getHash(salt: string) {
    return ethers.keccak256(ethers.solidityPacked(["bytes32"], [salt]));
}

describe("HashCrash", function () {
    async function baseFixture() {
        const [deployer, alice, bob, charlie, dave] = await ethers.getSigners();

        const genesisSalt = ethers.hexlify(ethers.randomBytes(32));

        const TOKEN = await ethers.getContractFactory("MockERC20");
        const token = await TOKEN.deploy();
        await token.waitForDeployment();

        const FixedRTP10x = await ethers.getContractFactory("FixedRTP10x");
        const lootTable = await FixedRTP10x.deploy();
        await lootTable.waitForDeployment();

        const HASHCRASH = await ethers.getContractFactory("HashCrashHarness");
        const sut = await HASHCRASH.deploy(
            lootTable.target,
            getHash(genesisSalt),
            deployer.address,
            maxExposureNumerator,
            lowLiquidityThreshold,
            deployer.address,
            token.target,
            minimumValue
        );
        await sut.waitForDeployment();

        return {
            sut,
            token,
            lootTable,
            wallets: {
                deployer,
                alice,
                bob,
                charlie,
                dave,
            },
            config: {
                genesisSalt,
                genesisHash: getHash(genesisSalt),
                hashProducer: deployer.address,
                owner: deployer.address,
                introBlocks: 20,
                reducedIntroBlocks: 5,
                cancelReturnNumerator: 9700n, // 97%
                liquidityPerRound: (total: bigint) => (total * 1000n) / 10000n,
            },
        };
    }

    async function activeFixture() {
        const { sut, lootTable, token, wallets, config } = await baseFixture();

        await sut.setActive(true);

        return { sut, lootTable, token, wallets, config };
    }

    async function tokenBalanceFixture() {
        const { sut, lootTable, token, wallets, config } = await activeFixture();

        // Mint some tokens to the wallets
        await token.mint(wallets.deployer.address, initialBalance);
        await token.mint(wallets.alice.address, initialBalance);
        await token.mint(wallets.bob.address, initialBalance);
        await token.mint(wallets.charlie.address, initialBalance);
        await token.mint(wallets.dave.address, initialBalance);

        // Approve the contract to spend tokens on behalf of the wallets
        await token.connect(wallets.deployer).approve(sut.target, initialBalance);
        await token.connect(wallets.alice).approve(sut.target, initialBalance);
        await token.connect(wallets.bob).approve(sut.target, initialBalance);
        await token.connect(wallets.charlie).approve(sut.target, initialBalance);
        await token.connect(wallets.dave).approve(sut.target, initialBalance);

        return { sut, lootTable, token, wallets, config };
    }

    async function liquidFixture() {
        const { sut, lootTable, token, wallets, config } = await tokenBalanceFixture();

        // Deposit some tokens into the contract
        await sut.deposit(initialBalance);

        // Restore the token balance for the deployer
        await token.mint(wallets.deployer.address, initialBalance);
        await token.approve(sut.target, initialBalance);

        return { sut, lootTable, token, wallets, config };
    }

    async function predictableDeathTable() {
        const { sut, token, wallets, config } = await liquidFixture();

        const LootTable = await ethers.getContractFactory("PredictableDeathTable");
        const lootTable = await LootTable.deploy();
        await lootTable.waitForDeployment();

        await sut.setLootTable(lootTable.target);

        const bets = [
            { wallet: wallets.deployer, amount: oneEther, cashoutIndex: 0 },
            { wallet: wallets.alice, amount: oneEther, cashoutIndex: 1 },
            { wallet: wallets.bob, amount: oneEther, cashoutIndex: 2 },
            { wallet: wallets.charlie, amount: oneEther, cashoutIndex: 3 },
            { wallet: wallets.dave, amount: oneEther, cashoutIndex: 4 },
        ];

        for (const bet of bets) {
            await sut.connect(bet.wallet).placeBet(bet.amount, bet.cashoutIndex);
        }

        return { sut, lootTable, token, wallets, config: { ...config, bets, introBlocks: config.introBlocks - 5 } };
    }

    async function noDeathTable() {
        const { sut, token, wallets, config } = await liquidFixture();

        const LootTable = await ethers.getContractFactory("NoDeathTable");
        const lootTable = await LootTable.deploy();
        await lootTable.waitForDeployment();

        await sut.setLootTable(lootTable.target);

        const bets = [
            { wallet: wallets.deployer, amount: oneEther, cashoutIndex: 0 },
            { wallet: wallets.alice, amount: oneEther, cashoutIndex: 1 },
            { wallet: wallets.bob, amount: oneEther, cashoutIndex: 2 },
            { wallet: wallets.charlie, amount: oneEther, cashoutIndex: 3 },
            { wallet: wallets.dave, amount: oneEther, cashoutIndex: 4 },
        ];

        for (const bet of bets) {
            await sut.connect(bet.wallet).placeBet(bet.amount, bet.cashoutIndex);
        }

        return { sut, lootTable, token, wallets, config: { ...config, bets, introBlocks: config.introBlocks - 5 } };
    }

    async function betFixture() {
        const { sut, lootTable, token, wallets, config } = await liquidFixture();

        const bets = [
            { wallet: wallets.deployer, amount: oneEther, cashoutIndex: 10 },
            { wallet: wallets.alice, amount: oneEther * 2n, cashoutIndex: 9 },
            { wallet: wallets.bob, amount: oneEther * 3n, cashoutIndex: 8 },
            { wallet: wallets.charlie, amount: oneEther * 4n, cashoutIndex: 7 },
        ];

        for (const bet of bets) {
            await sut.connect(bet.wallet).placeBet(bet.amount, bet.cashoutIndex);
        }

        return { sut, lootTable, token, wallets, config: { ...config, bets, introBlocks: config.introBlocks - 4 } };
    }

    async function completedBetFixture() {
        const { sut, lootTable, token, wallets, config } = await betFixture();

        const length = Number(await lootTable.getLength());
        await mine(config.introBlocks + length + 1); // + 1 otherwise cant read that final block hash

        const deathProof = await lootTable.getDeathProof(config.genesisSalt, await sut.getRoundStartBlock());

        return { sut, lootTable, token, wallets, config: { ...config, deathProof } };
    }

    async function unrecoverableRoundFixture() {
        const fixture = await completedBetFixture();

        await mine(1000);

        return fixture;
    }

    // ############################ TESTS ############################

    describe("stress tests", function () {
        // NOTE: The max gas we are realistically willing to pay for reveal is ~12 million gas (~$0.50)
        const softcap = 12500000n;
        const batchSize = 32n;

        async function stressTestFixture() {
            const { sut, token, wallets, config } = await activeFixture();

            const initialBalance = ethers.parseEther("100000");
            await token.mint(wallets.deployer.address, initialBalance);
            await token.approve(sut.target, initialBalance);
            await sut.deposit(initialBalance);

            const MaliciousBetter = await ethers.getContractFactory("MaliciousBetter");
            const maliciousBetter = await MaliciousBetter.deploy();
            await maliciousBetter.waitForDeployment();

            const MaliciousLiquidityProvider = await ethers.getContractFactory("MaliciousLiquidityProvider");
            const maliciousLiquidityProvider = await MaliciousLiquidityProvider.deploy();
            await maliciousLiquidityProvider.waitForDeployment();

            const NoDeathTable = await ethers.getContractFactory("NoDeathTable");
            const lootTable = await NoDeathTable.deploy();
            await lootTable.waitForDeployment();

            await sut.setLootTable(lootTable.target);

            await token.mint(wallets.deployer.address, initialBalance);
            await token.approve(sut.target, initialBalance);

            return { sut, token, lootTable, wallets, config, maliciousBetter, maliciousLiquidityProvider };
        }

        async function stressTestWithDepositsFixture() {
            const { sut, token, lootTable, wallets, config, maliciousBetter, maliciousLiquidityProvider } =
                await stressTestFixture();

            const minimum = await sut.getMinimum();

            await token.mint(maliciousLiquidityProvider.target, minimum * _MAX_LIQUIDITY_QUEUE_SIZE);

            let remaining = _MAX_LIQUIDITY_QUEUE_SIZE;
            let startIndex = 0n;
            while (remaining > 0n) {
                const deposits = remaining > batchSize ? batchSize : remaining;
                await maliciousLiquidityProvider.multiDeposit(sut.target, token.target, deposits, startIndex);
                remaining -= deposits;
                startIndex += deposits;
            }

            return { sut, token, lootTable, wallets, config, maliciousBetter, maliciousLiquidityProvider };
        }

        it("Should reveal with max winning bets", async function () {
            const { sut, token, lootTable, maliciousBetter, config } = await loadFixture(stressTestFixture);

            const minBet = await sut.getMinimum();
            const length = Number(await lootTable.getLength());

            await token.mint(maliciousBetter.target, minBet * _MAX_BET_QUEUE_SIZE);

            let remaining = _MAX_BET_QUEUE_SIZE;
            while (remaining > 0n) {
                const bets = remaining > batchSize ? batchSize : remaining;
                await maliciousBetter.multiBet(sut.target, token.target, bets, minBet, length - 1);
                remaining -= bets;
            }

            await mine(config.introBlocks + length);

            const tx = await sut.reveal(config.genesisSalt, config.genesisHash);
            const receipt = await tx.wait();

            if (!receipt) {
                throw new Error("Reveal transaction failed");
            }

            expect(receipt.gasUsed).to.be.lessThan(softcap);
        });

        it("Should reveal with max cancelled bets", async function () {
            const { sut, token, lootTable, maliciousBetter, config } = await loadFixture(stressTestFixture);

            const minBet = await sut.getMinimum();
            const length = Number(await lootTable.getLength());

            await token.mint(maliciousBetter.target, minBet * _MAX_BET_QUEUE_SIZE);

            let remaining = _MAX_BET_QUEUE_SIZE;
            let startIndex = 0n;
            while (remaining > 0n) {
                const bets = remaining > batchSize ? batchSize : remaining;
                await maliciousBetter.multiBetCancel(sut.target, token.target, bets, minBet, length - 1, startIndex);
                remaining -= bets;
                startIndex += bets;
            }

            await mine(config.introBlocks + length);

            const tx = await sut.reveal(config.genesisSalt, config.genesisHash);
            const receipt = await tx.wait();

            if (!receipt) {
                throw new Error("Reveal transaction failed");
            }

            expect(receipt.gasUsed).to.be.lessThan(softcap);
        });

        it("Should reveal with max liquidity deposits", async function () {
            const { sut, token, lootTable, maliciousLiquidityProvider, config } = await loadFixture(stressTestFixture);

            const minimum = await sut.getMinimum();
            const length = Number(await lootTable.getLength());

            await token.mint(maliciousLiquidityProvider.target, minimum * _MAX_LIQUIDITY_QUEUE_SIZE);
            await sut.placeBet(minimum, length - 1);

            let remaining = _MAX_LIQUIDITY_QUEUE_SIZE;
            let startIndex = 0n;
            while (remaining > 0n) {
                const deposits = remaining > batchSize ? batchSize : remaining;
                await maliciousLiquidityProvider.multiDeposit(sut.target, token.target, deposits, startIndex);
                remaining -= deposits;
                startIndex += deposits;
            }
            await mine(config.introBlocks + length);

            const tx = await sut.reveal(config.genesisSalt, config.genesisHash);
            const receipt = await tx.wait();

            if (!receipt) {
                throw new Error("Reveal transaction failed");
            }

            expect(receipt.gasUsed).to.be.lessThan(softcap);
        });

        it("Should reveal with max liquidity withdraws", async function () {
            const { sut, lootTable, maliciousLiquidityProvider, config } =
                await loadFixture(stressTestWithDepositsFixture);

            const minDeposit = await sut.getMinimum();
            const length = Number(await lootTable.getLength());

            await sut.placeBet(minDeposit, length - 1);

            let remaining = _MAX_LIQUIDITY_QUEUE_SIZE;
            let startIndex = 0n;
            while (remaining > 0n) {
                const withdraws = remaining > batchSize ? batchSize : remaining;
                await maliciousLiquidityProvider.multiWithdraw(sut.target, withdraws, startIndex);
                remaining -= withdraws;
                startIndex += withdraws;
            }

            await mine(config.introBlocks + length);

            const tx = await sut.reveal(config.genesisSalt, config.genesisHash);
            const receipt = await tx.wait();

            if (!receipt) {
                throw new Error("Reveal transaction failed");
            }

            expect(receipt.gasUsed).to.be.lessThan(softcap);
        });

        it("Should reveal with max winning bets AND liquidity withdraws", async function () {
            const { sut, token, lootTable, maliciousBetter, maliciousLiquidityProvider, config } =
                await loadFixture(stressTestWithDepositsFixture);

            const minimum = await sut.getMinimum();
            const length = Number(await lootTable.getLength());

            await token.mint(maliciousBetter.target, minimum * _MAX_BET_QUEUE_SIZE);

            let remaining = _MAX_BET_QUEUE_SIZE;
            while (remaining > 0n) {
                const bets = remaining > batchSize ? batchSize : remaining;
                await maliciousBetter.multiBet(sut.target, token.target, bets, minimum, length - 1);
                remaining -= bets;
            }

            remaining = _MAX_LIQUIDITY_QUEUE_SIZE;
            let startIndex = 0n;
            while (remaining > 0n) {
                const withdraws = remaining > batchSize ? batchSize : remaining;
                await maliciousLiquidityProvider.multiWithdraw(sut.target, withdraws, startIndex);
                remaining -= withdraws;
                startIndex += withdraws;
            }

            await mine(config.introBlocks + length);

            const tx = await sut.reveal(config.genesisSalt, config.genesisHash);
            const receipt = await tx.wait();

            if (!receipt) {
                throw new Error("Reveal transaction failed");
            }

            expect(receipt.gasUsed).to.be.lessThan(softcap);
        });
    });

    describe("constructor", function () {
        it("Should set the owner address", async function () {
            const { sut, config } = await loadFixture(baseFixture);

            expect(await sut.owner()).to.equal(config.owner);
        });

        it("Should set the low liquidity threshold", async function () {
            const { sut } = await loadFixture(baseFixture);

            expect(await sut.getLowLiquidityThreshold()).to.equal(lowLiquidityThreshold);
        });

        it("Should set the minimum value", async function () {
            const { sut } = await loadFixture(baseFixture);

            expect(await sut.getMinimum()).to.equal(minimumValue);
        });

        it("Should set active to false", async function () {
            const { sut } = await loadFixture(baseFixture);

            expect(await sut.getActive()).to.equal(false);
        });

        it("Should set the intro blocks to 20", async function () {
            const { sut, config } = await loadFixture(baseFixture);

            expect(await sut.getIntroBlocks()).to.equal(config.introBlocks);
        });

        it("Should set the reduced intro blocks to 5", async function () {
            const { sut, config } = await loadFixture(baseFixture);

            expect(await sut.getReducedIntroBlocks()).to.equal(config.reducedIntroBlocks);
        });

        it("Should set the cancel return to 9700 (97%)", async function () {
            const { sut, config } = await loadFixture(baseFixture);

            expect(await sut.getCancelReturnNumerator()).to.equal(config.cancelReturnNumerator);
        });

        it("Should set the genesis hash", async function () {
            const { sut, config } = await loadFixture(baseFixture);

            expect(await sut.getRoundHash()).to.equal(config.genesisHash);
        });

        it("Should set the hash producer", async function () {
            const { sut, config } = await loadFixture(baseFixture);

            expect(await sut.getHashProducer()).to.equal(config.hashProducer);
        });

        it("Should set the loot table", async function () {
            const { sut, lootTable } = await loadFixture(baseFixture);

            expect(await sut.getLootTable()).to.equal(lootTable.target);
        });

        it("Should revert if the hash is zero", async function () {
            const { token, lootTable, config } = await loadFixture(baseFixture);

            const SUT = await ethers.getContractFactory("HashCrashHarness");

            await expect(
                SUT.deploy(
                    lootTable.target,
                    ethers.ZeroHash,
                    config.hashProducer,
                    maxExposureNumerator,
                    lowLiquidityThreshold,
                    config.owner,
                    token.target,
                    minimumValue
                )
            )
                .to.be.revertedWithCustomError(SUT, "InvalidBytes")
                .withArgs(ethers.ZeroHash);
        });

        it("Should revert if the loot table address is zero", async function () {
            const { token, config } = await loadFixture(baseFixture);

            const SUT = await ethers.getContractFactory("HashCrashHarness");

            await expect(
                SUT.deploy(
                    ethers.ZeroAddress,
                    config.genesisHash,
                    config.hashProducer,
                    maxExposureNumerator,
                    lowLiquidityThreshold,
                    config.owner,
                    token.target,
                    minimumValue
                )
            )
                .to.be.revertedWithCustomError(SUT, "InvalidAddress")
                .withArgs(ethers.ZeroAddress);
        });

        it("Should emit setup events", async function () {
            const { token, lootTable, config } = await loadFixture(baseFixture);

            const HASHCRASH = await ethers.getContractFactory("HashCrashHarness");
            const tx = await HASHCRASH.deploy(
                lootTable.target,
                config.genesisHash,
                config.hashProducer,
                maxExposureNumerator,
                lowLiquidityThreshold,
                config.owner,
                token.target,
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

    describe("getActive", function () {
        it("Should return false by default", async function () {
            const { sut } = await loadFixture(baseFixture);

            expect(await sut.getActive()).to.equal(false);
        });

        it("Should return the set _active value", async function () {
            const { sut } = await loadFixture(activeFixture);

            expect(await sut.getActive()).to.equal(true);
        });
    });

    describe("getHashIndex", function () {
        it("Should return zero by default", async function () {
            const { sut } = await loadFixture(baseFixture);

            expect(await sut.getHashIndex()).to.equal(0n);
        });

        it("Should return the hash index", async function () {
            const { sut, config } = await loadFixture(completedBetFixture);

            await sut.reveal(config.genesisSalt, config.genesisHash);

            expect(await sut.getHashIndex()).to.equal(1n);
        });
    });

    describe("getRoundStartBlock", function () {
        it("Should return the start block at 0", async function () {
            const { sut } = await loadFixture(baseFixture);

            expect(await sut.getRoundStartBlock()).to.equal(0);
        });

        it("Should return the start block when set", async function () {
            const { sut, config } = await loadFixture(liquidFixture);

            await sut.placeBet(oneEther, 10);

            const currentBlock = await ethers.provider.getBlockNumber();

            expect(await sut.getRoundStartBlock()).to.equal(currentBlock + config.introBlocks);
        });
    });

    describe("getRoundHash", function () {
        it("Should return the round hash", async function () {
            const { sut, config } = await loadFixture(baseFixture);

            expect(await sut.getRoundHash()).to.equal(config.genesisHash);
        });
    });

    describe("getHashProducer", function () {
        it("Should return the hash producer", async function () {
            const { sut, config } = await loadFixture(baseFixture);

            expect(await sut.getHashProducer()).to.equal(config.hashProducer);
        });
    });

    describe("getCancelReturnNumerator", function () {
        it("Should return the cancel return numerator", async function () {
            const { sut, config } = await loadFixture(baseFixture);

            expect(await sut.getCancelReturnNumerator()).to.equal(config.cancelReturnNumerator);
        });
    });

    describe("getLootTable", function () {
        it("Should return the loot table", async function () {
            const { sut, lootTable } = await loadFixture(baseFixture);

            expect(await sut.getLootTable()).to.equal(lootTable.target);
        });
    });

    describe("getStagedLootTable", function () {
        it("Should return address(0) by default", async function () {
            const { sut } = await loadFixture(baseFixture);

            expect(await sut.getStagedLootTable()).to.equal(ethers.ZeroAddress);
        });

        it("Should return the staged loot table", async function () {
            const { sut, wallets } = await loadFixture(liquidFixture);

            await sut.placeBet(oneEther, 10);
            await sut.setLootTable(wallets.bob.address);

            expect(await sut.getStagedLootTable()).to.equal(wallets.bob.address);
        });
    });

    describe("getIntroBlocks", function () {
        it("Should return the set intro blocks", async function () {
            const { sut, config } = await loadFixture(baseFixture);

            expect(await sut.getIntroBlocks()).to.equal(config.introBlocks);
        });
    });

    describe("getReducedIntroBlocks", function () {
        it("Should return the set reduced intro blocks", async function () {
            const { sut, config } = await loadFixture(baseFixture);

            expect(await sut.getReducedIntroBlocks()).to.equal(config.reducedIntroBlocks);
        });
    });

    describe("getBetsLength", function () {
        it("Should return zero by default", async function () {
            const { sut } = await loadFixture(baseFixture);

            expect(await sut.getBetsLength()).to.equal(0n);
        });

        it("Should return the number of bets", async function () {
            const { sut } = await loadFixture(liquidFixture);

            await sut.placeBet(oneEther, 10);
            await sut.placeBet(oneEther, 9);

            expect(await sut.getBetsLength()).to.equal(2n);
        });
    });

    describe("getBet", function () {
        it("Should revert if the bet does not exist", async function () {
            const { sut } = await loadFixture(baseFixture);

            await expect(sut.getBet(0n)).to.be.revertedWithCustomError(sut, "BetNotFound");
        });

        it("Should return the bet", async function () {
            const { sut, wallets } = await loadFixture(liquidFixture);

            const cashoutIndex = 10;
            await sut.placeBet(oneEther, cashoutIndex);

            const bet = await sut.getBet(0n);

            expect(bet.amount).to.equal(oneEther);
            expect(bet.cashoutIndex).to.equal(cashoutIndex);
            expect(bet.user).to.equal(wallets.deployer.address);
            expect(bet.cancelled).to.equal(false);
        });
    });

    describe("getBets", function () {
        it("Should return an empty array by default", async function () {
            const { sut } = await loadFixture(baseFixture);

            expect(await sut.getBets()).to.deep.equal([]);
        });

        it("Should return the bets", async function () {
            const { sut, wallets } = await loadFixture(liquidFixture);

            const cashoutIndex = 10;

            await sut.placeBet(oneEther, cashoutIndex);

            const bets = await sut.getBets();
            expect(bets.length).to.equal(1);

            expect(bets[0].user).to.equal(wallets.deployer.address);
            expect(bets[0].amount).to.equal(oneEther);
            expect(bets[0].cashoutIndex).to.equal(cashoutIndex);
            expect(bets[0].cancelled).to.equal(false);
        });
    });

    describe("getBetsFor", function () {
        it("Should return an empty array by default", async function () {
            const { sut } = await loadFixture(baseFixture);

            expect(await sut.getBetsFor(ethers.ZeroAddress)).to.deep.equal([]);
        });

        it("Should return the bets for the user", async function () {
            const { sut, wallets } = await loadFixture(liquidFixture);

            const cashoutIndex = 10;

            await sut.placeBet(oneEther, cashoutIndex);
            await sut.connect(wallets.alice).placeBet(oneEther, cashoutIndex);

            const bets = await sut.getBetsFor(wallets.deployer.address);
            expect(bets.length).to.equal(1);

            expect(bets[0].user).to.equal(wallets.deployer.address);
            expect(bets[0].amount).to.equal(oneEther);
            expect(bets[0].cashoutIndex).to.equal(cashoutIndex);
            expect(bets[0].cancelled).to.equal(false);
        });
    });

    describe("getBlockHashes", function () {
        it("Should return no block hashes when the round is idle", async function () {
            const { sut } = await loadFixture(baseFixture);

            expect(await sut.getBlockHashes()).to.deep.equal([]);
        });

        it("Should return no block hashes before the start block", async function () {
            const { sut } = await loadFixture(liquidFixture);

            await sut.placeBet(oneEther, 10);

            expect(await sut.getBlockHashes()).to.deep.equal([]);
        });

        it("Should return no block hashes on the start block", async function () {
            const { sut, config } = await loadFixture(liquidFixture);

            await sut.placeBet(oneEther, 10);

            await mine(config.introBlocks);

            expect(await ethers.provider.getBlockNumber()).to.equal(await sut.getRoundStartBlock());
            expect(await sut.getBlockHashes()).to.deep.equal([]);
        });

        it("Should return all block hashes between the start block (inc) and current block (exc)", async function () {
            const { sut, config } = await loadFixture(liquidFixture);

            const amount = 5;

            await sut.placeBet(oneEther, 10);

            await mine(config.introBlocks);

            const startBlock = await ethers.provider.getBlockNumber();

            await mine(amount);

            const blockHashes = await sut.getBlockHashes();
            expect(blockHashes.length).to.equal(amount);
            for (let i = 0; i < amount; i++) {
                expect(blockHashes[i]).to.equal(await ethers.provider.getBlock(startBlock + i).then((b) => b!.hash));
            }
        });

        it("Should return at max, loot table length block hashes", async function () {
            const { sut, lootTable, config } = await loadFixture(liquidFixture);

            await sut.placeBet(oneEther, 10);

            await mine(config.introBlocks);

            const startBlock = await ethers.provider.getBlockNumber();

            const lootTableLength = Number(await lootTable.getLength());
            await mine(lootTableLength * 2);

            const blockHashes = await sut.getBlockHashes();
            expect(blockHashes.length).to.equal(lootTableLength);
            for (let i = 0; i < lootTableLength; i++) {
                expect(blockHashes[i]).to.equal(await ethers.provider.getBlock(startBlock + i).then((b) => b!.hash));
            }
        });

        it("Should return bytes32(0) when the hashes are no longer available", async function () {
            const { sut, lootTable } = await loadFixture(liquidFixture);

            await sut.placeBet(oneEther, 10);

            await mine(1000);

            const lootTableLength = Number(await lootTable.getLength());
            const blockHashes = await sut.getBlockHashes();
            expect(blockHashes.length).to.equal(lootTableLength);
            for (let i = 0; i < lootTableLength; i++) {
                expect(blockHashes[i]).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
            }
        });
    });

    describe("getRoundInfo", function () {
        describe("active_", function () {
            it("Should return false by default", async function () {
                const { sut } = await loadFixture(baseFixture);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.active_).to.equal(false);
            });

            it("Should return the set _active value", async function () {
                const { sut } = await loadFixture(activeFixture);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.active_).to.equal(true);
            });
        });

        describe("hashIndex_", function () {
            it("Should return zero by default", async function () {
                const { sut } = await loadFixture(baseFixture);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.hashIndex_).to.equal(0n);
            });

            it("Should return the hash index", async function () {
                const { sut, config } = await loadFixture(completedBetFixture);

                await sut.reveal(config.genesisSalt, config.genesisHash);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.hashIndex_).to.equal(1n);
            });
        });

        describe("startBlock_", function () {
            it("Should return the start block at 0", async function () {
                const { sut } = await loadFixture(baseFixture);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.startBlock_).to.equal(0);
            });

            it("Should return the start block when set", async function () {
                const { sut, config } = await loadFixture(liquidFixture);

                await sut.placeBet(oneEther, 10);

                const currentBlock = await ethers.provider.getBlockNumber();
                const roundInfo = await sut.getRoundInfo();

                expect(roundInfo.startBlock_).to.equal(currentBlock + config.introBlocks);
            });
        });

        describe("lootTable_", function () {
            it("Should return the loot table", async function () {
                const { sut, lootTable } = await loadFixture(baseFixture);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.lootTable_).to.equal(lootTable.target);
            });
        });

        describe("minimum_", function () {
            it("Should return minimum", async function () {
                const { sut } = await loadFixture(baseFixture);

                const minimum = await sut.getMinimum();
                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.minimum_).to.equal(minimum);
            });
        });

        describe("roundLiquidity_", function () {
            it("Should return the round liquidity when zero", async function () {
                const { sut } = await loadFixture(baseFixture);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.roundLiquidity_).to.equal(0);
            });

            it("Should return the round liquidity when set", async function () {
                const { sut, config } = await loadFixture(tokenBalanceFixture);

                await sut.deposit(oneEther);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.roundLiquidity_).to.equal(config.liquidityPerRound(oneEther));
            });
        });

        describe("hash_", function () {
            it("Should return the round hash", async function () {
                const { sut, config } = await loadFixture(baseFixture);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.hash_).to.equal(config.genesisHash);
            });
        });

        describe("bets_", function () {
            it("Should return an empty array by default", async function () {
                const { sut } = await loadFixture(baseFixture);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.bets_).to.deep.equal([]);
            });

            it("Should return the bets", async function () {
                const { sut, wallets } = await loadFixture(liquidFixture);

                const cashoutIndex = 10;

                await sut.placeBet(oneEther, cashoutIndex);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.bets_.length).to.equal(1);

                expect(roundInfo.bets_[0].user).to.equal(wallets.deployer.address);
                expect(roundInfo.bets_[0].amount).to.equal(oneEther);
                expect(roundInfo.bets_[0].cashoutIndex).to.equal(cashoutIndex);
                expect(roundInfo.bets_[0].cancelled).to.equal(false);
            });
        });

        describe("blockHashes_", function () {
            it("Should return no block hashes when the round is idle", async function () {
                const { sut } = await loadFixture(baseFixture);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.blockHashes_).to.deep.equal([]);
            });

            it("Should return no block hashes before the start block", async function () {
                const { sut } = await loadFixture(liquidFixture);

                await sut.placeBet(oneEther, 10);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.blockHashes_).to.deep.equal([]);
            });

            it("Should return no block hashes on the start block", async function () {
                const { sut, config } = await loadFixture(liquidFixture);

                await sut.placeBet(oneEther, 10);

                await mine(config.introBlocks);

                const roundInfo = await sut.getRoundInfo();

                expect(await ethers.provider.getBlockNumber()).to.equal(roundInfo.startBlock_);
                expect(roundInfo.blockHashes_).to.deep.equal([]);
            });

            it("Should return all block hashes between the start block (inc) and current block (exc)", async function () {
                const { sut, config } = await loadFixture(liquidFixture);

                const amount = 5;

                await sut.placeBet(oneEther, 10);

                await mine(config.introBlocks);

                const startBlock = await ethers.provider.getBlockNumber();

                await mine(amount);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.blockHashes_.length).to.equal(amount);
                for (let i = 0; i < amount; i++) {
                    expect(roundInfo.blockHashes_[i]).to.equal(
                        await ethers.provider.getBlock(startBlock + i).then((b) => b!.hash)
                    );
                }
            });

            it("Should return at max, loot table length block hashes", async function () {
                const { sut, lootTable, config } = await loadFixture(liquidFixture);

                await sut.placeBet(oneEther, 10);

                await mine(config.introBlocks);

                const startBlock = await ethers.provider.getBlockNumber();

                const lootTableLength = Number(await lootTable.getLength());
                await mine(lootTableLength * 2);

                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.blockHashes_.length).to.equal(lootTableLength);
                for (let i = 0; i < lootTableLength; i++) {
                    expect(roundInfo.blockHashes_[i]).to.equal(
                        await ethers.provider.getBlock(startBlock + i).then((b) => b!.hash)
                    );
                }
            });

            it("Should return bytes32(0) when the hashes are no longer available", async function () {
                const { sut, lootTable } = await loadFixture(liquidFixture);

                await sut.placeBet(oneEther, 10);

                await mine(1000);

                const lootTableLength = Number(await lootTable.getLength());
                const roundInfo = await sut.getRoundInfo();
                expect(roundInfo.blockHashes_.length).to.equal(lootTableLength);
                for (let i = 0; i < lootTableLength; i++) {
                    expect(roundInfo.blockHashes_[i]).to.equal(
                        "0x0000000000000000000000000000000000000000000000000000000000000000"
                    );
                }
            });
        });
    });

    describe("setActive", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(baseFixture);

            await expect(sut.connect(wallets.alice).setActive(true)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should do nothing when the same value is passed", async function () {
            const { sut } = await loadFixture(baseFixture);

            expect(await sut.getActive()).to.equal(false);
            await sut.setActive(false);
            expect(await sut.getActive()).to.equal(false);
        });

        it("Should set active", async function () {
            const { sut } = await loadFixture(baseFixture);

            await sut.setActive(true);

            expect(await sut.getActive()).to.equal(true);
        });

        it("Should emit ActiveUpdated", async function () {
            const { sut } = await loadFixture(baseFixture);

            await expect(sut.setActive(true)).to.emit(sut, "ActiveUpdated").withArgs(true);
        });
    });

    describe("setHashProducer", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(baseFixture);

            await expect(sut.connect(wallets.alice).setHashProducer(wallets.bob.address)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if the address is the zero address", async function () {
            const { sut } = await loadFixture(baseFixture);

            await expect(sut.setHashProducer(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(sut, "InvalidAddress")
                .withArgs(ethers.ZeroAddress);
        });

        it("Should set the hash producer", async function () {
            const { sut, wallets } = await loadFixture(baseFixture);

            await sut.setHashProducer(wallets.bob.address);

            expect(await sut.getHashProducer()).to.equal(wallets.bob.address);
        });

        it("Should emit HashProducerUpdated", async function () {
            const { sut, wallets } = await loadFixture(baseFixture);

            await expect(sut.setHashProducer(wallets.bob.address))
                .to.emit(sut, "HashProducerUpdated")
                .withArgs(wallets.bob.address);
        });
    });

    describe("setCancelReturnNumerator", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(baseFixture);

            await expect(sut.connect(wallets.alice).setCancelReturnNumerator(10)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if the value is greater than 10000", async function () {
            const { sut } = await loadFixture(baseFixture);

            await expect(sut.setCancelReturnNumerator(10001))
                .to.be.revertedWithCustomError(sut, "InvalidValue")
                .withArgs(10001);
        });

        it("Should set the cancel return numerator", async function () {
            const { sut } = await loadFixture(baseFixture);

            await sut.setCancelReturnNumerator(10);

            expect(await sut.getCancelReturnNumerator()).to.equal(10);
        });

        it("Should emit CancelReturnNumeratorUpdated", async function () {
            const { sut } = await loadFixture(baseFixture);

            await expect(sut.setCancelReturnNumerator(10)).to.emit(sut, "CancelReturnNumeratorUpdated").withArgs(10);
        });
    });

    describe("setIntroBlocks", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(baseFixture);

            await expect(sut.connect(wallets.alice).setIntroBlocks(10)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if the value is 0", async function () {
            const { sut } = await loadFixture(baseFixture);

            await expect(sut.setIntroBlocks(0n)).to.be.revertedWithCustomError(sut, "InvalidValue").withArgs(0n);
        });

        it("Should revert if the value is less than reduced intro blocks", async function () {
            const { sut } = await loadFixture(baseFixture);

            const reducedIntroBlocks = await sut.getReducedIntroBlocks();
            await expect(sut.setIntroBlocks(reducedIntroBlocks - 1n))
                .to.be.revertedWithCustomError(sut, "InvalidValue")
                .withArgs(reducedIntroBlocks - 1n);
        });

        it("Should set the intro blocks", async function () {
            const { sut } = await loadFixture(baseFixture);

            await sut.setIntroBlocks(10);

            expect(await sut.getIntroBlocks()).to.equal(10);
        });

        it("Should emit IntroBlocksUpdated", async function () {
            const { sut } = await loadFixture(baseFixture);

            await expect(sut.setIntroBlocks(10)).to.emit(sut, "IntroBlocksUpdated").withArgs(10);
        });
    });

    describe("setReducedIntroBlocks", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(baseFixture);

            await expect(sut.connect(wallets.alice).setReducedIntroBlocks(10)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if the value is 0", async function () {
            const { sut } = await loadFixture(baseFixture);

            await expect(sut.setReducedIntroBlocks(0n)).to.be.revertedWithCustomError(sut, "InvalidValue").withArgs(0n);
        });

        it("Should revert if the value is greater than intro blocks", async function () {
            const { sut } = await loadFixture(baseFixture);

            const introBlocks = await sut.getIntroBlocks();
            await expect(sut.setReducedIntroBlocks(introBlocks + 1n))
                .to.be.revertedWithCustomError(sut, "InvalidValue")
                .withArgs(introBlocks + 1n);
        });

        it("Should set the reduced intro blocks", async function () {
            const { sut } = await loadFixture(baseFixture);

            await sut.setReducedIntroBlocks(10);

            expect(await sut.getReducedIntroBlocks()).to.equal(10);
        });

        it("Should emit ReducedIntroBlocksUpdated", async function () {
            const { sut } = await loadFixture(baseFixture);

            await expect(sut.setReducedIntroBlocks(10)).to.emit(sut, "ReducedIntroBlocksUpdated").withArgs(10);
        });
    });

    describe("setLootTable", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(baseFixture);

            await expect(sut.connect(wallets.alice).setLootTable(wallets.bob.address)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if the address is zero", async function () {
            const { sut } = await loadFixture(baseFixture);

            await expect(sut.setLootTable(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(sut, "InvalidAddress")
                .withArgs(ethers.ZeroAddress);
        });

        it("Should set the loot table address", async function () {
            const { sut, wallets } = await loadFixture(baseFixture);

            await sut.setLootTable(wallets.alice.address);

            expect(await sut.getLootTable()).to.equal(wallets.alice.address);
        });

        it("Should stage the loot table when not idle", async function () {
            const { sut, wallets } = await loadFixture(liquidFixture);

            await sut.placeBet(oneEther, 10);

            await sut.setLootTable(wallets.bob.address);

            expect(await sut.getLootTable()).to.not.equal(wallets.bob.address);
            expect(await sut.getStagedLootTable()).to.equal(wallets.bob.address);
        });
    });

    describe("placeBet", function () {
        it("Should revert if the amount is below the minimum", async function () {
            const { sut } = await loadFixture(liquidFixture);

            await expect(sut.placeBet(minimumValue - 1n, 10))
                .to.be.revertedWithCustomError(sut, "ValueBelowMinimum")
                .withArgs(minimumValue - 1n);
        });

        describe("_initialiseRound", function () {
            it("Should revert if active is not set", async function () {
                const { sut } = await loadFixture(liquidFixture);

                await sut.setActive(false);

                await expect(sut.placeBet(oneEther, 10)).to.be.revertedWithCustomError(sut, "NotActive");
            });

            describe("has staged loot table", function () {
                async function stagedLootTableFixture() {
                    const { sut, lootTable, token, wallets, config } = await loadFixture(liquidFixture);

                    const FixedRTP100x = await ethers.getContractFactory("FixedRTP100x");
                    const stagedLootTable = await FixedRTP100x.deploy();
                    await stagedLootTable.waitForDeployment();

                    await sut.placeBet(oneEther, 10);
                    await sut.setLootTable(stagedLootTable.target);

                    await mine(config.introBlocks + Number(await lootTable.getLength()));

                    await sut.reveal(config.genesisSalt, config.genesisHash);

                    expect(await sut.getStagedLootTable()).to.equal(stagedLootTable.target);

                    return {
                        sut,
                        lootTable,
                        token,
                        wallets,
                        config: {
                            ...config,
                            stagedLootTable,
                        },
                    };
                }

                it("Should update the loot table", async function () {
                    const { sut, config } = await loadFixture(stagedLootTableFixture);

                    await sut.placeBet(oneEther, 10);

                    expect(await sut.getLootTable()).to.equal(config.stagedLootTable.target);
                });

                it("Should emit LootTableUpdated", async function () {
                    const { sut, config } = await loadFixture(stagedLootTableFixture);

                    await expect(sut.placeBet(oneEther, 10))
                        .to.emit(sut, "LootTableUpdated")
                        .withArgs(config.stagedLootTable.target);
                });

                it("Should remove the staged loot table", async function () {
                    const { sut } = await loadFixture(stagedLootTableFixture);

                    await sut.placeBet(oneEther, 10);

                    expect(await sut.getStagedLootTable()).to.equal(ethers.ZeroAddress);
                });
            });

            it("Should set the round start block", async function () {
                const { sut, config } = await loadFixture(liquidFixture);

                await sut.placeBet(oneEther, 10);
                const currentBlock = await ethers.provider.getBlockNumber();

                expect(await sut.getRoundStartBlock()).to.equal(currentBlock + config.introBlocks);
            });

            it("Should emit RoundStarted", async function () {
                const { sut, config } = await loadFixture(liquidFixture);

                const liquidity = await sut.getAvailableLiquidity();
                const previous = await ethers.provider.getBlockNumber();
                const expectedStartBlock = previous + 1 + config.introBlocks; // +1 because event is emitted during the next block

                await expect(sut.placeBet(oneEther, 10))
                    .to.emit(sut, "RoundStarted")
                    .withArgs(config.genesisHash, expectedStartBlock, 0, liquidity);
            });
        });

        it("Should revert if the bet is beyond _MAX_BET_QUEUE_SIZE", async function () {
            const { sut, token } = await loadFixture(liquidFixture);

            const MaliciousBetter = await ethers.getContractFactory("MaliciousBetter");
            const maliciousBetter = await MaliciousBetter.deploy();
            await maliciousBetter.waitForDeployment();

            await token.mint(maliciousBetter.target, oneEther * 100n);

            // Not important for this test
            await sut.setMinimum(1n);

            let remaining = _MAX_BET_QUEUE_SIZE;
            while (remaining > 0n) {
                const bets = remaining > 32n ? 32n : remaining;
                await maliciousBetter.multiBet(sut.target, token.target, bets, 1000n, 10n);
                remaining -= bets;
            }

            await expect(sut.placeBet(oneEther, 10)).to.be.revertedWithCustomError(sut, "RoundIsFull");
        });

        it("Should revert if the round has already started", async function () {
            const { sut, config } = await loadFixture(liquidFixture);

            await sut.placeBet(oneEther, 10);

            await mine(config.introBlocks);

            await expect(sut.placeBet(oneEther, 10)).to.be.revertedWithCustomError(sut, "RoundInProgress");
        });

        it("Should revert if the cashout index is outside of the loot table", async function () {
            const { sut, lootTable } = await loadFixture(liquidFixture);

            const length = await lootTable.getLength();

            await expect(sut.placeBet(oneEther, length + 1n))
                .to.be.revertedWithCustomError(sut, "InvalidValue")
                .withArgs(length + 1n);
        });

        it("Should escrow the value", async function () {
            const { sut, token, wallets } = await loadFixture(liquidFixture);

            const initialBalance = await token.balanceOf(wallets.deployer.address);
            const initialContractBalance = await token.balanceOf(sut.target);

            await sut.placeBet(oneEther, 10);

            expect(await token.balanceOf(wallets.deployer.address)).to.equal(initialBalance - oneEther);
            expect(await token.balanceOf(sut.target)).to.equal(initialContractBalance + oneEther);
        });

        it("Should revert if there is insufficient liquidity", async function () {
            const { sut } = await loadFixture(tokenBalanceFixture);

            await expect(sut.placeBet(oneEther, 10)).to.be.revertedWithCustomError(sut, "InsufficientLiquidity");
        });

        it("Should reduce the round liquidity", async function () {
            const { sut, lootTable } = await loadFixture(liquidFixture);

            const cashout = 10;

            const maxWin = await lootTable.multiply(oneEther, cashout);

            const initialLiquidity = await sut.getAvailableLiquidity();

            await sut.placeBet(oneEther, cashout);

            expect(await sut.getAvailableLiquidity()).to.equal(initialLiquidity - maxWin);
        });

        it("Should store the bet", async function () {
            const { sut, wallets } = await loadFixture(liquidFixture);

            const cashoutIndex = 10;

            await sut.placeBet(oneEther, cashoutIndex);

            const bets = await sut.getBetsFor(wallets.deployer.address);

            expect(bets.length).to.equal(1);
            expect(bets[0].user).to.equal(wallets.deployer.address);
            expect(bets[0].amount).to.equal(oneEther);
            expect(bets[0].cashoutIndex).to.equal(cashoutIndex);
            expect(bets[0].cancelled).to.equal(false);
        });

        it("Should emit BetPlaced", async function () {
            const { sut, wallets, config } = await loadFixture(liquidFixture);

            let betIndex = 0;
            let cashoutIndex = 10;

            await expect(sut.placeBet(oneEther, cashoutIndex))
                .to.emit(sut, "BetPlaced")
                .withArgs(config.genesisHash, betIndex, wallets.deployer.address, oneEther, cashoutIndex);

            betIndex++;
            cashoutIndex = 9;

            await expect(sut.placeBet(oneEther, cashoutIndex))
                .to.emit(sut, "BetPlaced")
                .withArgs(config.genesisHash, betIndex, wallets.deployer.address, oneEther, cashoutIndex);
        });
    });

    describe("updateBet", function () {
        it("Should revert if the index is out of range", async function () {
            const { sut, config } = await loadFixture(betFixture);

            await expect(sut.updateBet(config.bets.length, 10)).to.be.revertedWithCustomError(sut, "BetNotFound");
        });

        it("Should revert if the caller does not own the bet", async function () {
            const { sut, wallets } = await loadFixture(betFixture);

            await expect(sut.connect(wallets.charlie).updateBet(0, 10)).to.be.revertedWithCustomError(
                sut,
                "BetNotYours"
            );
        });

        it("Should revert if the bet is cancelled", async function () {
            const { sut } = await loadFixture(betFixture);

            await sut.cancelBet(0);

            await expect(sut.updateBet(0, 10)).to.be.revertedWithCustomError(sut, "BetIsCancelled");
        });

        it("Should revert if the round is in progress", async function () {
            const { sut, config } = await loadFixture(betFixture);

            await mine(config.introBlocks);

            await expect(sut.updateBet(0, 10)).to.be.revertedWithCustomError(sut, "RoundInProgress");
        });

        it("Should revert if the cashout index is out of range", async function () {
            const { sut, lootTable } = await loadFixture(betFixture);

            const length = await lootTable.getLength();
            await expect(sut.updateBet(0, length + 1n))
                .to.be.revertedWithCustomError(sut, "InvalidValue")
                .withArgs(length + 1n);
        });

        it("Should use the correct amount of round liquidity", async function () {
            const { sut, lootTable, config } = await loadFixture(betFixture);

            const initialRoundLiquidity = await sut.getAvailableLiquidity();
            const initialLiquidity = await lootTable.multiply(config.bets[0].amount, config.bets[0].cashoutIndex);

            const newCashoutIndex = config.bets[0].cashoutIndex - 1;

            await sut.updateBet(0, newCashoutIndex);

            const newRoundLiquidity = await sut.getAvailableLiquidity();
            const newLiquidity = await lootTable.multiply(config.bets[0].amount, newCashoutIndex);

            expect(newRoundLiquidity).to.equal(initialRoundLiquidity + initialLiquidity - newLiquidity);
        });

        it("Should revert if there is no longer enough liquidity", async function () {
            const { sut, lootTable } = await loadFixture(betFixture);

            const length = await lootTable.getLength();

            for (let i = 0; i < 8; i++) {
                await sut.placeBet(oneEther, length - 1n);
            }

            await expect(sut.updateBet(0, length - 1n)).to.be.revertedWithCustomError(sut, "InsufficientLiquidity");
        });

        it("Should update the cashout index", async function () {
            const { sut, wallets, config } = await loadFixture(betFixture);

            const newCashoutIndex = config.bets[0].cashoutIndex - 1;
            await sut.updateBet(0, newCashoutIndex);

            const bets = await sut.getBetsFor(wallets.deployer.address);
            expect(bets[0].cashoutIndex).to.equal(newCashoutIndex);
        });

        it("Should emit BetCashoutUpdated", async function () {
            const { sut, config } = await loadFixture(betFixture);

            const newCashoutIndex = config.bets[0].cashoutIndex - 1;

            await expect(sut.updateBet(0, newCashoutIndex))
                .to.emit(sut, "BetCashoutUpdated")
                .withArgs(config.genesisHash, 0, newCashoutIndex);
        });
    });

    describe("cancelBet", function () {
        it("Should revert if the index is out of range", async function () {
            const { sut, config } = await loadFixture(betFixture);

            await expect(sut.cancelBet(config.bets.length)).to.be.revertedWithCustomError(sut, "BetNotFound");
        });

        it("Should revert if the caller does not own the bet", async function () {
            const { sut, wallets } = await loadFixture(betFixture);

            await expect(sut.connect(wallets.charlie).cancelBet(0)).to.be.revertedWithCustomError(sut, "BetNotYours");
        });

        it("Should revert if the bet is cancelled", async function () {
            const { sut } = await loadFixture(betFixture);

            await sut.cancelBet(0);

            await expect(sut.cancelBet(0)).to.be.revertedWithCustomError(sut, "BetIsCancelled");
        });

        it("Should revert if the round is in progress", async function () {
            const { sut, config } = await loadFixture(betFixture);

            await mine(config.introBlocks);

            await expect(sut.cancelBet(0)).to.be.revertedWithCustomError(sut, "RoundInProgress");
        });

        it("Should set cancelled to true", async function () {
            const { sut, wallets } = await loadFixture(betFixture);

            const betsBefore = await sut.getBetsFor(wallets.deployer.address);
            expect(betsBefore[0].cancelled).to.equal(false);

            await sut.cancelBet(0);

            const betsAfter = await sut.getBetsFor(wallets.deployer.address);
            expect(betsAfter[0].cancelled).to.equal(true);
        });

        it("Should refund the value minus a fee", async function () {
            const { sut, token, wallets, config } = await loadFixture(betFixture);

            const initialBalance = await token.balanceOf(wallets.deployer.address);
            const initialContractBalance = await token.balanceOf(sut.target);

            const refunded = (oneEther * config.cancelReturnNumerator) / 10000n;

            await sut.cancelBet(0);

            expect(await token.balanceOf(wallets.deployer.address)).to.equal(initialBalance + refunded);
            expect(await token.balanceOf(sut.target)).to.equal(initialContractBalance - refunded);
        });

        it("Should release the round liquidity", async function () {
            const { sut, lootTable, config } = await loadFixture(betFixture);

            const initialRoundLiquidity = await sut.getAvailableLiquidity();
            const initialLiquidity = await lootTable.multiply(config.bets[0].amount, config.bets[0].cashoutIndex);

            await sut.cancelBet(0);

            const newRoundLiquidity = await sut.getAvailableLiquidity();

            expect(newRoundLiquidity).to.equal(initialRoundLiquidity + initialLiquidity);
        });

        it("Should emit BetCancelled", async function () {
            const { sut, config } = await loadFixture(betFixture);

            await expect(sut.cancelBet(0)).to.emit(sut, "BetCancelled").withArgs(config.genesisHash, 0);
        });
    });

    describe("cashout", function () {
        it("Should revert if the index is out of range", async function () {
            const { sut, config } = await loadFixture(betFixture);

            await mine(config.introBlocks);

            await expect(sut.cashout(config.bets.length)).to.be.revertedWithCustomError(sut, "BetNotFound");
        });

        it("Should revert if the caller does not own the bet", async function () {
            const { sut, wallets, config } = await loadFixture(betFixture);

            await mine(config.introBlocks);

            await expect(sut.connect(wallets.charlie).cashout(0)).to.be.revertedWithCustomError(sut, "BetNotYours");
        });

        it("Should revert if the bet is cancelled", async function () {
            const { sut, config } = await loadFixture(betFixture);

            await sut.cancelBet(0);

            await mine(config.introBlocks);

            await expect(sut.cashout(0)).to.be.revertedWithCustomError(sut, "BetIsCancelled");
        });

        it("Should revert if the round has not started yet", async function () {
            const { sut } = await loadFixture(betFixture);

            await expect(sut.cashout(0)).to.be.revertedWithCustomError(sut, "RoundNotStarted");
        });

        it("Should revert if the cashout index has already passed", async function () {
            const { sut, config } = await loadFixture(betFixture);

            await mine(config.introBlocks + config.bets[0].cashoutIndex + 1);

            await expect(sut.cashout(0)).to.be.revertedWithCustomError(sut, "AlreadyCashedOut");
        });

        it("Should update the cashout index", async function () {
            const { sut, wallets, config } = await loadFixture(betFixture);

            await mine(config.introBlocks);

            await mine(config.bets[0].cashoutIndex - 3);

            await sut.cashout(0);

            const updatedBets = await sut.getBetsFor(wallets.deployer.address);
            expect(updatedBets[0].cashoutIndex).to.equal(config.bets[0].cashoutIndex - 3);
        });

        it("Should emit BetCashoutUpdated", async function () {
            const { sut, config } = await loadFixture(betFixture);

            await mine(config.introBlocks);

            await mine(config.bets[0].cashoutIndex - 3);

            await expect(sut.cashout(0))
                .to.emit(sut, "BetCashoutUpdated")
                .withArgs(config.genesisHash, 0, config.bets[0].cashoutIndex - 3);
        });
    });

    describe("reveal", function () {
        const nextHash = ethers.hexlify(ethers.randomBytes(32));

        it("Should revert if the caller is not the hash producer", async function () {
            const { sut, wallets, config } = await loadFixture(completedBetFixture);

            await expect(sut.connect(wallets.alice).reveal(config.genesisSalt, nextHash)).to.be.revertedWithCustomError(
                sut,
                "NotHashProducer"
            );
        });

        it("Should revert if the next hash is bytes32(0)", async function () {
            const { sut, config } = await loadFixture(baseFixture);

            const nextHash = ethers.ZeroHash;
            await expect(sut.reveal(config.genesisSalt, nextHash))
                .to.be.revertedWithCustomError(sut, "InvalidBytes")
                .withArgs(nextHash);
        });

        it("Should revert if the hash does not match the salt", async function () {
            const { sut } = await loadFixture(baseFixture);

            const salt = ethers.hexlify(ethers.randomBytes(32));
            await expect(sut.reveal(salt, nextHash)).to.be.revertedWithCustomError(sut, "InvalidBytes").withArgs(salt);
        });

        it("Should revert if this function was called too early", async function () {
            const { sut, lootTable, config } = await loadFixture(betFixture);

            await expect(sut.reveal(config.genesisSalt, nextHash)).to.be.revertedWithCustomError(
                lootTable,
                "MissingBlockhash"
            );
        });

        it("Should revert if this function was called too late", async function () {
            const { sut, lootTable, config } = await loadFixture(betFixture);

            await mine(1000);

            await expect(sut.reveal(config.genesisSalt, nextHash)).to.be.revertedWithCustomError(
                lootTable,
                "MissingBlockhash"
            );
        });

        it("Should revert if this function was called after an emergency refund", async function () {
            const { sut, lootTable, config } = await loadFixture(betFixture);

            await mine(1000);

            await sut.emergencyRefund();

            await expect(sut.reveal(config.genesisSalt, nextHash)).to.be.revertedWithCustomError(
                lootTable,
                "MissingBlockhash"
            );
        });

        it("Should get the expected dead index", async function () {
            const { sut, config } = await loadFixture(completedBetFixture);

            await expect(sut.reveal(config.genesisSalt, nextHash))
                .to.emit(sut, "RoundEnded")
                .withArgs(config.genesisHash, config.genesisSalt, config.deathProof.deadIndex, config.deathProof.proof);
        });

        it("Should payout winning bets", async function () {
            const { sut, lootTable, token, config } = await loadFixture(predictableDeathTable);

            const length = Number(await lootTable.getLength());

            await mine(config.introBlocks + length + 1);

            const deathProof = await lootTable.getDeathProof(config.genesisSalt, await sut.getRoundStartBlock());

            const sutBalanceBefore = await token.balanceOf(sut.target);
            const beforeBalances = await Promise.all(config.bets.map((b) => token.balanceOf(b.wallet.address)));

            await sut.reveal(config.genesisSalt, nextHash);

            const sutBalanceAfter = await token.balanceOf(sut.target);
            const afterBalances = await Promise.all(config.bets.map((b) => token.balanceOf(b.wallet.address)));

            let sum = 0n;
            for (let i = 0; i < Number(deathProof.deadIndex); i++) {
                const expectedWin = await lootTable.multiply(config.bets[i].amount, config.bets[i].cashoutIndex);
                expect(afterBalances[i]).to.equal(beforeBalances[i] + expectedWin);
                sum += expectedWin;
            }

            expect(sutBalanceAfter).to.equal(sutBalanceBefore - sum);
        });

        it("Should payout winning bets when there is no dead block", async function () {
            const { sut, lootTable, token, config } = await loadFixture(noDeathTable);

            const length = Number(await lootTable.getLength());

            await mine(config.introBlocks + length + 1);

            const deathProof = await lootTable.getDeathProof(config.genesisSalt, await sut.getRoundStartBlock());

            expect(deathProof.deadIndex).to.equal(length);

            const sutBalanceBefore = await token.balanceOf(sut.target);
            const beforeBalances = await Promise.all(config.bets.map((b) => token.balanceOf(b.wallet.address)));

            await sut.reveal(config.genesisSalt, nextHash);

            const sutBalanceAfter = await token.balanceOf(sut.target);
            const afterBalances = await Promise.all(config.bets.map((b) => token.balanceOf(b.wallet.address)));

            let sum = 0n;
            for (let i = 0; i < Number(deathProof.deadIndex); i++) {
                const expectedWin = await lootTable.multiply(config.bets[i].amount, config.bets[i].cashoutIndex);
                expect(afterBalances[i]).to.equal(beforeBalances[i] + expectedWin);
                sum += expectedWin;
            }

            expect(sutBalanceAfter).to.equal(sutBalanceBefore - sum);
        });

        it("Should ignore cancelled bets", async function () {
            const { sut, lootTable, token, config } = await loadFixture(predictableDeathTable);

            const cancelToExc = 2;
            const length = Number(await lootTable.getLength());

            for (let i = 0; i < cancelToExc; i++) {
                await sut.connect(config.bets[i].wallet).cancelBet(i);
            }

            await mine(config.introBlocks + length - cancelToExc + 1);

            const deathProof = await lootTable.getDeathProof(config.genesisSalt, await sut.getRoundStartBlock());

            const sutBalanceBefore = await token.balanceOf(sut.target);
            const beforeBalances = await Promise.all(config.bets.map((b) => token.balanceOf(b.wallet.address)));

            await sut.reveal(config.genesisSalt, nextHash);

            const sutBalanceAfter = await token.balanceOf(sut.target);
            const afterBalances = await Promise.all(config.bets.map((b) => token.balanceOf(b.wallet.address)));

            let sum = 0n;
            for (let i = cancelToExc; i < Number(deathProof.deadIndex); i++) {
                const expectedWin = await lootTable.multiply(config.bets[i].amount, config.bets[i].cashoutIndex);
                expect(afterBalances[i]).to.equal(beforeBalances[i] + expectedWin);
                sum += expectedWin;
            }

            expect(sutBalanceAfter).to.equal(sutBalanceBefore - sum);
        });

        it("Should ignore dead bets", async function () {
            const { sut, lootTable, token, config } = await loadFixture(predictableDeathTable);

            const length = Number(await lootTable.getLength());

            await mine(config.introBlocks + length + 1);

            const deathProof = await lootTable.getDeathProof(config.genesisSalt, await sut.getRoundStartBlock());

            const beforeBalances = await Promise.all(config.bets.map((b) => token.balanceOf(b.wallet.address)));

            await sut.reveal(config.genesisSalt, nextHash);

            const afterBalances = await Promise.all(config.bets.map((b) => token.balanceOf(b.wallet.address)));

            for (let i = Number(deathProof.deadIndex); i < config.bets.length; i++) {
                expect(afterBalances[i]).to.equal(beforeBalances[i]);
            }
        });

        it("Should clear the bets", async function () {
            const { sut, config } = await loadFixture(completedBetFixture);

            expect(await sut.getBetsLength()).to.equal(config.bets.length);

            await sut.reveal(config.genesisSalt, nextHash);

            expect(await sut.getBetsLength()).to.equal(0);
        });

        it("Should clear the bet cancellations", async function () {
            const { sut, lootTable, config } = await loadFixture(betFixture);

            await sut.cancelBet(0);

            const length = Number(await lootTable.getLength());
            await mine(config.introBlocks + length + 1);

            await sut.reveal(config.genesisSalt, config.genesisHash);

            await sut.placeBet(oneEther, 10);

            const bets = await sut.getBets();
            expect(bets.length).to.equal(1);
            expect(bets[0].cancelled).to.equal(false);
        });

        it("Should clear the liquidity queue", async function () {
            const { sut, wallets, config } = await loadFixture(completedBetFixture);

            await sut.connect(wallets.alice).deposit(oneEther);
            await sut.connect(wallets.bob).deposit(oneEther);

            const liquidityQueue = await sut.getLiquidityQueue();
            expect(liquidityQueue.length).to.equal(2);

            await sut.reveal(config.genesisSalt, nextHash);

            const newLiquidityQueue = await sut.getLiquidityQueue();
            expect(newLiquidityQueue.length).to.equal(0);
        });

        it("Should emit RoundEnded", async function () {
            const { sut, config } = await loadFixture(completedBetFixture);

            await expect(sut.reveal(config.genesisSalt, nextHash))
                .to.emit(sut, "RoundEnded")
                .withArgs(config.genesisHash, config.genesisSalt, config.deathProof.deadIndex, config.deathProof.proof);
        });

        it("Should reset the round start block", async function () {
            const { sut, config } = await loadFixture(completedBetFixture);

            await sut.reveal(config.genesisSalt, nextHash);

            expect(await sut.getRoundStartBlock()).to.equal(0);
        });

        it("Should set the new round hash", async function () {
            const { sut, config } = await loadFixture(completedBetFixture);

            await sut.reveal(config.genesisSalt, nextHash);

            expect(await sut.getRoundHash()).to.equal(nextHash);
        });

        it("Should increment the hashIndex", async function () {
            const { sut, config } = await loadFixture(completedBetFixture);

            const previous = await sut.getHashIndex();

            await sut.reveal(config.genesisSalt, nextHash);

            expect(await sut.getHashIndex()).to.equal(previous + 1n);
        });
    });

    describe("emergencyRefund", function () {
        it("Should revert if the round is idle", async function () {
            const { sut } = await loadFixture(baseFixture);

            await expect(sut.emergencyRefund()).to.be.revertedWithCustomError(sut, "RoundNotRefundable");
        });

        it("Should revert if the round has not started yet", async function () {
            const { sut } = await loadFixture(betFixture);

            await expect(sut.emergencyRefund()).to.be.revertedWithCustomError(sut, "RoundNotRefundable");
        });

        it("Should revert if the round can still be revealed", async function () {
            const { sut } = await loadFixture(completedBetFixture);

            await expect(sut.emergencyRefund()).to.be.revertedWithCustomError(sut, "RoundNotRefundable");
        });

        it("Should not be callable until 256 blocks have passed the round start block", async function () {
            const { sut, config } = await loadFixture(liquidFixture);

            await expect(sut.emergencyRefund()).to.be.revertedWithCustomError(sut, "RoundNotRefundable");
            await sut.placeBet(minimumValue, 10);

            for (let i = 0; i < config.introBlocks + 256; i++) {
                await expect(sut.emergencyRefund()).to.be.revertedWithCustomError(sut, "RoundNotRefundable");
            }

            await expect(sut.emergencyRefund()).to.not.be.reverted;
        });

        it("Should be callable by anyone", async function () {
            const { sut, wallets } = await loadFixture(predictableDeathTable);

            await mine(1000);

            await expect(sut.connect(wallets.alice).emergencyRefund()).to.not.be.reverted;
        });

        it("Should refund non-cancelled bets", async function () {
            const { sut, token, config } = await loadFixture(predictableDeathTable);

            await mine(1000);

            const sutBalanceBefore = await token.balanceOf(sut.target);
            const beforeBalances = await Promise.all(config.bets.map((b) => token.balanceOf(b.wallet.address)));

            await sut.emergencyRefund();

            let sum = 0n;
            for (let i = 0; i < config.bets.length; i++) {
                expect(await token.balanceOf(config.bets[i].wallet.address)).to.equal(
                    beforeBalances[i] + config.bets[i].amount
                );
                sum += config.bets[i].amount;
            }

            expect(await token.balanceOf(sut.target)).to.equal(sutBalanceBefore - sum);
        });

        it("Should ignore cancelled bets", async function () {
            const { sut, token, config } = await loadFixture(predictableDeathTable);

            const cancelToExc = 2;

            for (let i = 0; i < cancelToExc; i++) {
                await sut.connect(config.bets[i].wallet).cancelBet(i);
            }

            await mine(1000);

            const sutBalanceBefore = await token.balanceOf(sut.target);
            const beforeBalances = await Promise.all(config.bets.map((b) => token.balanceOf(b.wallet.address)));

            await sut.emergencyRefund();

            let sum = 0n;
            for (let i = cancelToExc; i < config.bets.length; i++) {
                expect(await token.balanceOf(config.bets[i].wallet.address)).to.equal(
                    beforeBalances[i] + config.bets[i].amount
                );
                sum += config.bets[i].amount;
            }

            expect(await token.balanceOf(sut.target)).to.equal(sutBalanceBefore - sum);
        });

        it("Should clear the bets", async function () {
            const { sut, config } = await loadFixture(unrecoverableRoundFixture);

            expect(await sut.getBetsLength()).to.equal(config.bets.length);

            await sut.emergencyRefund();

            expect(await sut.getBetsLength()).to.equal(0);
        });

        it("Should clear the liquidity queue", async function () {
            const { sut, wallets } = await loadFixture(unrecoverableRoundFixture);

            await sut.connect(wallets.alice).deposit(oneEther);
            await sut.connect(wallets.bob).deposit(oneEther);

            const liquidityQueue = await sut.getLiquidityQueue();
            expect(liquidityQueue.length).to.equal(2);

            await sut.emergencyRefund();

            const newLiquidityQueue = await sut.getLiquidityQueue();
            expect(newLiquidityQueue.length).to.equal(0);
        });

        it("Should emit RoundRefunded", async function () {
            const { sut, config } = await loadFixture(unrecoverableRoundFixture);

            await expect(sut.emergencyRefund()).to.emit(sut, "RoundRefunded").withArgs(config.genesisHash);
        });

        it("Should reset the round start block", async function () {
            const { sut } = await loadFixture(unrecoverableRoundFixture);

            await sut.emergencyRefund();

            expect(await sut.getRoundStartBlock()).to.equal(0);
        });

        it("Should set active to false", async function () {
            const { sut } = await loadFixture(unrecoverableRoundFixture);

            await sut.emergencyRefund();

            expect(await sut.getActive()).to.equal(false);
        });

        it("Should emit ActiveUpdated", async function () {
            const { sut } = await loadFixture(unrecoverableRoundFixture);

            await expect(sut.emergencyRefund()).to.emit(sut, "ActiveUpdated").withArgs(false);
        });

        it("Should keep the same hash", async function () {
            const { sut, config } = await loadFixture(unrecoverableRoundFixture);

            await sut.emergencyRefund();

            expect(await sut.getRoundHash()).to.equal(config.genesisHash);
        });

        it("Should keep the same hash index", async function () {
            const { sut } = await loadFixture(unrecoverableRoundFixture);

            const previous = await sut.getHashIndex();

            await sut.emergencyRefund();

            expect(await sut.getHashIndex()).to.equal(previous);
        });
    });

    describe("_onLowLiquidity", function () {
        it("Should do nothing if the start block is zero", async function () {
            const { sut } = await loadFixture(liquidFixture);

            expect(await sut.getRoundStartBlock()).to.equal(0);

            await sut.callOnLowLiquidity();

            expect(await sut.getRoundStartBlock()).to.equal(0);
        });

        it("Should do nothing if the start block is already below the reduced value", async function () {
            const { sut, config } = await loadFixture(liquidFixture);

            await sut.placeBet(oneEther, 10);
            const startblock = (await ethers.provider.getBlockNumber()) + config.introBlocks;

            await mine(config.introBlocks - config.reducedIntroBlocks);

            expect(await sut.getRoundStartBlock()).to.equal(startblock);

            await sut.callOnLowLiquidity();

            expect(await sut.getRoundStartBlock()).to.equal(startblock);
        });

        it("Should set the round start block to the new reduced value", async function () {
            const { sut, config } = await loadFixture(liquidFixture);

            await sut.placeBet(oneEther, 10);
            const startblock = (await ethers.provider.getBlockNumber()) + config.introBlocks;

            expect(await sut.getRoundStartBlock()).to.equal(startblock);

            await sut.callOnLowLiquidity();
            const newStartBlock = (await ethers.provider.getBlockNumber()) + config.reducedIntroBlocks;

            expect(await sut.getRoundStartBlock()).to.equal(newStartBlock);
        });

        it("Should emit RoundAccelerated", async function () {
            const { sut, config } = await loadFixture(liquidFixture);

            await sut.placeBet(oneEther, 10);

            const previousBlockNumber = await ethers.provider.getBlockNumber();
            await expect(sut.callOnLowLiquidity())
                .to.emit(sut, "RoundAccelerated")
                .withArgs(config.genesisHash, previousBlockNumber + 1 + config.reducedIntroBlocks);
        });
    });
});
