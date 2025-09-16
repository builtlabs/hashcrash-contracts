import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

const oneEther = ethers.parseEther("1");

describe("GrindRewardPool", function () {
    async function fixture() {
        const [deployer, alice, bob] = await ethers.getSigners();

        const TOKEN = await ethers.getContractFactory("MockERC20");
        const token = await TOKEN.deploy();
        await token.waitForDeployment();

        const SUT = await ethers.getContractFactory("GrindRewardPool");
        const sut = await SUT.deploy(token.target, deployer.address);
        await sut.waitForDeployment();

        const seasonId = await sut.nextSeasonId();

        return {
            sut,
            token,
            wallets: {
                deployer,
                alice,
                bob,
            },
            seasonId,
        };
    }

    async function fixtureWithToken() {
        const { sut, token, wallets, seasonId } = await fixture();

        const totalGrind = oneEther * 1000n;
        await token.mint(wallets.deployer.address, totalGrind);
        await token.approve(sut.target, totalGrind);

        return {
            sut,
            token,
            wallets,
            seasonId,
            totalGrind,
        };
    }

    async function populatedFixture() {
        const { sut, token, wallets, seasonId, totalGrind } = await fixtureWithToken();

        await sut.populateGrind(seasonId, totalGrind);

        expect(await sut.seasonTotalGrind(seasonId)).to.equal(totalGrind);

        const signers = await ethers.getSigners();

        const users = signers.length;
        const pointData = Array.from({ length: users }, (_, i) => ({
            index: i,
            account: signers[i].address,
            points: BigInt(Math.round(1000 * (i + 1 + Math.random()))),
        }));
        const totalPoints = pointData.reduce((acc, p) => acc + p.points, 0n);

        await sut.populatePoints(seasonId, pointData);
        expect(await sut.seasonTotalPoints(seasonId)).to.equal(totalPoints);

        return {
            sut,
            token,
            wallets,
            seasonId,
            pointData,
            totalGrind,
            totalPoints,
        };
    }

    // ############################ TESTS ############################

    describe("integration", function () {
        it("Should correctly distribute grind", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            const seasonId = await sut.nextSeasonId();

            const totalGrind = oneEther * 1000n;
            await token.mint(wallets.deployer.address, totalGrind);
            await token.approve(sut.target, totalGrind);
            await sut.populateGrind(seasonId, totalGrind);

            expect(await sut.seasonTotalGrind(seasonId)).to.equal(totalGrind);

            const signers = await ethers.getSigners();

            const users = signers.length;
            const pointData = Array.from({ length: users }, (_, i) => ({
                index: i,
                account: signers[i].address,
                points: BigInt(Math.round(1000 * (i + 1 + Math.random()))),
            }));
            const totalPoints = pointData.reduce((acc, p) => acc + p.points, 0n);

            await sut.populatePoints(seasonId, pointData);
            expect(await sut.seasonTotalPoints(seasonId)).to.equal(totalPoints);

            await sut.openClaim(seasonId);

            let totalGrindClaimed = 0n;
            for (const { index, account, points } of pointData) {
                const expectedGrind = (points * totalGrind) / totalPoints;

                expect(await sut.seasonPoints(seasonId, account)).to.equal(points);
                expect(await sut.seasonGrind(seasonId, account)).to.equal(expectedGrind);

                const initialBalance = await token.balanceOf(account);
                await sut.connect(signers[index]).claimGrind(seasonId);
                expect(await sut.seasonPoints(seasonId, account)).to.equal(0n);
                expect(await sut.seasonGrind(seasonId, account)).to.equal(0n);
                expect(await token.balanceOf(account)).to.equal(initialBalance + expectedGrind);

                totalGrindClaimed += expectedGrind;
            }

            expect(await sut.seasonTotalGrind(seasonId)).to.be.lt(totalGrindClaimed + 100n);
            expect(await sut.seasonTotalGrind(seasonId)).to.be.gt(totalGrindClaimed - 100n);
        });
    });

    describe("constructor", function () {
        it("Should set the grind address", async function () {
            const { sut, token } = await loadFixture(fixture);

            expect(await sut.grind()).to.equal(token.target);
        });

        it("Should set the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            expect(await sut.owner()).to.equal(wallets.deployer.address);
        });
    });

    describe("openClaim", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets, seasonId } = await loadFixture(populatedFixture);

            await expect(sut.connect(wallets.alice).openClaim(seasonId)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if the season id is not the next season", async function () {
            const { sut, wallets, seasonId } = await loadFixture(populatedFixture);

            await expect(sut.openClaim(seasonId + 1n)).to.be.revertedWithCustomError(sut, "InvalidSeasonId");
        });

        it("Should revert if there is no grind", async function () {
            const { sut } = await loadFixture(fixture);

            const seasonId = await sut.nextSeasonId();

            const signers = await ethers.getSigners();

            const users = signers.length;
            const pointData = Array.from({ length: users }, (_, i) => ({
                index: i,
                account: signers[i].address,
                points: BigInt(Math.round(1000 * (i + 1 + Math.random()))),
            }));
            const totalPoints = pointData.reduce((acc, p) => acc + p.points, 0n);

            await sut.populatePoints(seasonId, pointData);
            expect(await sut.seasonTotalPoints(seasonId)).to.equal(totalPoints);

            await expect(sut.openClaim(seasonId)).to.be.revertedWithCustomError(sut, "SeasonHasNoGrind");
        });

        it("Should revert if there are no points", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            const seasonId = await sut.nextSeasonId();

            const totalGrind = oneEther * 1000n;
            await token.mint(wallets.deployer.address, totalGrind);
            await token.approve(sut.target, totalGrind);
            await sut.populateGrind(seasonId, totalGrind);

            await expect(sut.openClaim(seasonId)).to.be.revertedWithCustomError(sut, "SeasonHasNoPoints");
        });

        it("Should emit SeasonOpened", async function () {
            const { sut } = await loadFixture(populatedFixture);

            const nextSeasonId = await sut.nextSeasonId();

            await expect(sut.openClaim(nextSeasonId)).to.emit(sut, "SeasonOpened").withArgs(nextSeasonId);
        });

        it("Should increment the nextSeasonId", async function () {
            const { sut } = await loadFixture(populatedFixture);

            const nextSeasonId = await sut.nextSeasonId();

            await sut.openClaim(nextSeasonId);

            expect(await sut.nextSeasonId()).to.equal(nextSeasonId + 1n);
        });
    });

    describe("populateGrind", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets, seasonId, totalGrind } = await loadFixture(fixtureWithToken);

            await expect(sut.connect(wallets.alice).populateGrind(seasonId, totalGrind)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if the season id is not the next season", async function () {
            const { sut, seasonId, totalGrind } = await loadFixture(fixtureWithToken);

            await expect(sut.populateGrind(seasonId + 1n, totalGrind)).to.be.revertedWithCustomError(
                sut,
                "InvalidSeasonId"
            );
        });

        it("Should revert if the amount is 0", async function () {
            const { sut, wallets, seasonId, totalGrind } = await loadFixture(fixtureWithToken);

            await expect(sut.populateGrind(seasonId, 0n)).to.be.revertedWithCustomError(sut, "InvalidAmount");
        });

        it("Should revert if the transfer fails", async function () {
            const { sut, token, seasonId, totalGrind } = await loadFixture(fixtureWithToken);

            await token.mockReturn();

            await expect(sut.populateGrind(seasonId, totalGrind)).to.be.revertedWithCustomError(
                sut,
                "SafeERC20FailedOperation"
            );
        });

        it("Should increment the total grind amount", async function () {
            const { sut, wallets, seasonId, totalGrind } = await loadFixture(fixtureWithToken);

            await sut.populateGrind(seasonId, totalGrind);
            expect(await sut.seasonTotalGrind(seasonId)).to.equal(totalGrind);
        });

        it("Should emit GrindPopulated", async function () {
            const { sut, seasonId, totalGrind } = await loadFixture(fixtureWithToken);

            await expect(sut.populateGrind(seasonId, totalGrind))
                .to.be.emit(sut, "GrindPopulated")
                .withArgs(seasonId, totalGrind);
        });
    });

    describe("populatePoints", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const seasonId = await sut.nextSeasonId();
            const pointData = [
                { account: wallets.alice.address, points: 1000n },
                { account: wallets.bob.address, points: 2000n },
            ];

            await expect(sut.connect(wallets.alice).populatePoints(seasonId, pointData)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if the season id is not the next season", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const seasonId = await sut.nextSeasonId();
            const pointData = [
                { account: wallets.alice.address, points: 1000n },
                { account: wallets.bob.address, points: 2000n },
            ];

            await expect(sut.populatePoints(seasonId + 1n, pointData)).to.be.revertedWithCustomError(
                sut,
                "InvalidSeasonId"
            );
        });

        it("Should revert if a points amount is 0", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const seasonId = await sut.nextSeasonId();
            const pointData = [
                { account: wallets.alice.address, points: 1000n },
                { account: wallets.bob.address, points: 0n },
            ];

            await expect(sut.populatePoints(seasonId, pointData)).to.be.revertedWithCustomError(sut, "InvalidAmount");
        });

        it("Should revert if an address is zero", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const seasonId = await sut.nextSeasonId();
            const pointData = [
                { account: wallets.alice.address, points: 1000n },
                { account: ethers.ZeroAddress, points: 2000n },
            ];

            await expect(sut.populatePoints(seasonId, pointData)).to.be.revertedWithCustomError(
                sut,
                "InvalidAccountAddress"
            );
        });

        it("Should revert if there is a duplicate address", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const seasonId = await sut.nextSeasonId();
            const pointData = [
                { account: wallets.alice.address, points: 1000n },
                { account: wallets.alice.address, points: 2000n },
            ];

            await expect(sut.populatePoints(seasonId, pointData)).to.be.revertedWithCustomError(
                sut,
                "DuplicateAccountInPoints"
            );
        });

        it("Should set the users points", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const seasonId = await sut.nextSeasonId();
            const pointData = [
                { account: wallets.alice.address, points: 1000n },
                { account: wallets.bob.address, points: 2000n },
            ];

            await sut.populatePoints(seasonId, pointData);

            expect(await sut.seasonPoints(seasonId, wallets.alice.address)).to.equal(1000n);
            expect(await sut.seasonPoints(seasonId, wallets.bob.address)).to.equal(2000n);
        });

        it("Should increment the total season points", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const seasonId = await sut.nextSeasonId();
            const pointData = [
                { account: wallets.alice.address, points: 1000n },
                { account: wallets.bob.address, points: 2000n },
            ];

            await sut.populatePoints(seasonId, pointData);

            expect(await sut.seasonTotalPoints(seasonId)).to.equal(3000n);
        });

        it("Should emit PointsPopulated", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const seasonId = await sut.nextSeasonId();
            const pointData = [
                { account: wallets.alice.address, points: 1000n },
                { account: wallets.bob.address, points: 2000n },
            ];

            await expect(sut.populatePoints(seasonId, pointData))
                .to.emit(sut, "PointsPopulated")
                .withArgs(seasonId, wallets.alice.address, 1000n)
                .and.to.emit(sut, "PointsPopulated")
                .withArgs(seasonId, wallets.bob.address, 2000n);
        });
    });

    describe("claimGrind", function () {
        it("Should revert if the season id is the next season", async function () {
            const { sut, seasonId } = await loadFixture(populatedFixture);

            await expect(sut.claimGrind(seasonId)).to.be.revertedWithCustomError(sut, "InvalidSeasonId");
        });

        it("Should revert if the season id is greater than the next season", async function () {
            const { sut, seasonId } = await loadFixture(populatedFixture);

            await expect(sut.claimGrind(seasonId + 1n)).to.be.revertedWithCustomError(sut, "InvalidSeasonId");
        });

        it("Should revert if the user has no points", async function () {
            const { sut, wallets, seasonId } = await loadFixture(populatedFixture);

            await sut.openClaim(seasonId);

            await sut.connect(wallets.alice).claimGrind(seasonId);
            expect(await sut.seasonGrind(seasonId, wallets.alice.address)).to.equal(0n);

            await expect(sut.connect(wallets.alice).claimGrind(seasonId)).to.be.revertedWithCustomError(
                sut,
                "NothingToClaim"
            );
        });

        it("Should set the users points to 0", async function () {
            const { sut, wallets, seasonId } = await loadFixture(populatedFixture);

            await sut.openClaim(seasonId);

            const aliceGrind = await sut.seasonGrind(seasonId, wallets.alice.address);
            expect(aliceGrind).to.be.gt(0n);

            await sut.connect(wallets.alice).claimGrind(seasonId);
            expect(await sut.seasonGrind(seasonId, wallets.alice.address)).to.equal(0n);
        });

        it("Should send the expected amount of grind", async function () {
            const { sut, wallets, token, seasonId } = await loadFixture(populatedFixture);

            await sut.openClaim(seasonId);

            const aliceGrind = await sut.seasonGrind(seasonId, wallets.alice.address);
            expect(aliceGrind).to.be.gt(0n);

            const initialBalance = await token.balanceOf(wallets.alice.address);
            await sut.connect(wallets.alice).claimGrind(seasonId);
            expect(await token.balanceOf(wallets.alice.address)).to.equal(initialBalance + aliceGrind);
        });

        it("Should emit GrindClaimed", async function () {
            const { sut, wallets, seasonId, pointData } = await loadFixture(populatedFixture);

            await sut.openClaim(seasonId);

            const aliceData = pointData.find((p) => p.account === wallets.alice.address);
            const aliceGrind = await sut.seasonGrind(seasonId, wallets.alice.address);

            await expect(sut.connect(wallets.alice).claimGrind(seasonId))
                .to.emit(sut, "GrindClaimed")
                .withArgs(seasonId, aliceData?.account, aliceGrind, aliceData?.points);
        });
    });
});
