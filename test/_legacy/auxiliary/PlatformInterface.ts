import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { id } from "ethers";
import { ethers } from "hardhat";

const DENOMINATOR = 10000n;

const oneEther = ethers.parseEther("1");

describe("PlatformInterface", function () {
    async function fixture() {
        const [deployer, platform, a, b, c, d, e, f, g, h] = await ethers.getSigners();

        const WETH = await ethers.getContractFactory("WETH9");
        const weth = await WETH.deploy();
        await weth.waitForDeployment();

        const TOKEN = await ethers.getContractFactory("MockERC20");
        const token = await TOKEN.deploy();
        await token.waitForDeployment();

        const SUT = await ethers.getContractFactory("PlatformInterface");
        const sut = await SUT.deploy(platform.address, weth.target, deployer.address);
        await sut.waitForDeployment();

        /*
                B => D 
            A => 
                C
            E => F => G => H
        */
        await sut.connect(b).setReferredBy(a.address);
        await sut.connect(c).setReferredBy(a.address);
        await sut.connect(d).setReferredBy(b.address);

        await sut.connect(f).setReferredBy(e.address);
        await sut.connect(g).setReferredBy(f.address);
        await sut.connect(h).setReferredBy(g.address);

        return {
            sut,
            weth,
            token,
            wallets: {
                deployer,
                platform,
                a,
                b,
                c,
                d,
                e,
                f,
                g,
                h,
            },
        };
    }

    // ############################ TESTS ############################

    describe("constructor", function () {
        it("Should set the platform", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            expect(await sut.getPlatform()).to.equal(wallets.platform.address);
        });

        it("Should set referral[0]", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.getReferralReward(0)).to.equal(1500n); // 15%
        });

        it("Should set referral[1]", async function () {
            const { sut } = await loadFixture(fixture);

            expect(await sut.getReferralReward(1)).to.equal(500n); // 5%
        });

        it("Should emit PlatformSet and ReferralRewardSet", async function () {
            const { weth, wallets } = await loadFixture(fixture);

            const SUT = await ethers.getContractFactory("PlatformInterface");
            const sut = await SUT.deploy(wallets.platform.address, weth.target, wallets.deployer.address);
            const receipt = (await sut.deploymentTransaction()!.wait())!;

            const iface = SUT.interface;

            const platformSetTopic = id("PlatformSet(address)");
            const referralRewardSetTopic = id("ReferralRewardSet(uint256,uint256)");

            const setPlatformEvents = receipt.logs
                .filter((log) => log.topics[0] === platformSetTopic)
                .map((log) => iface.decodeEventLog("PlatformSet", log.data, log.topics));

            expect(setPlatformEvents).to.deep.include.members([[wallets.platform.address]]);

            const referralEvents = receipt.logs
                .filter((log) => log.topics[0] === referralRewardSetTopic)
                .map((log) => iface.decodeEventLog("ReferralRewardSet", log.data, log.topics));

            expect(referralEvents).to.deep.include.members([
                [0n, 1500n],
                [1n, 500n],
            ]);
        });
    });

    describe("startSeason", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const gamemodes = [wallets.a.address, wallets.b.address, wallets.c.address];

            await expect(sut.connect(wallets.b).startSeason(gamemodes))
                .to.be.revertedWithCustomError(sut, "OwnableUnauthorizedAccount")
                .withArgs(wallets.b.address);
        });

        it("Should emit SeasonStarted", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const season = await sut.getNextSeason();
            const gamemodes = [wallets.a.address, wallets.b.address, wallets.c.address];

            await expect(sut.startSeason(gamemodes)).to.emit(sut, "SeasonStarted").withArgs(season, gamemodes);
        });

        it("Should emit SeasonEnded if it has not yet ended", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const season = await sut.getNextSeason();
            const gamemodes = [wallets.a.address, wallets.b.address, wallets.c.address];

            await sut.startSeason(gamemodes);

            await expect(sut.startSeason(gamemodes)).to.emit(sut, "SeasonEnded").withArgs(season);
        });

        it("Should not emit SeasonEnded when it has already ended", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const gamemodes = [wallets.a.address, wallets.b.address, wallets.c.address];

            await sut.startSeason(gamemodes);
            await sut.endSeason();

            await expect(sut.startSeason(gamemodes)).to.not.emit(sut, "SeasonEnded");
        });
    });

    describe("endSeason", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.b).endSeason())
                .to.be.revertedWithCustomError(sut, "OwnableUnauthorizedAccount")
                .withArgs(wallets.b.address);
        });

        it("Should revert if the season has not been started", async function () {
            const { sut } = await loadFixture(fixture);

            await expect(sut.endSeason()).to.be.revertedWithCustomError(sut, "SeasonNotStarted");
        });

        it("Should revert if the season has already ended", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const gamemodes = [wallets.a.address, wallets.b.address, wallets.c.address];
            await sut.startSeason(gamemodes);
            await sut.endSeason();

            await expect(sut.endSeason()).to.be.revertedWithCustomError(sut, "SeasonNotStarted");
        });

        it("Should emit SeasonEnded", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const season = await sut.getNextSeason();
            const gamemodes = [wallets.a.address, wallets.b.address, wallets.c.address];
            await sut.startSeason(gamemodes);

            await expect(sut.endSeason()).to.emit(sut, "SeasonEnded").withArgs(season);
        });
    });

    describe("setPlatform", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.b).setPlatform(wallets.a.address))
                .to.be.revertedWithCustomError(sut, "OwnableUnauthorizedAccount")
                .withArgs(wallets.b.address);
        });

        it("Should revert if setting the platform to the zero address", async function () {
            const { sut } = await loadFixture(fixture);

            await expect(sut.setPlatform(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(sut, "InvalidAddress")
                .withArgs(ethers.ZeroAddress);
        });

        it("Should set the platform", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await sut.connect(wallets.deployer).setPlatform(wallets.a.address);

            expect(await sut.getPlatform()).to.equal(wallets.a.address);
        });

        it("Should emit PlatformSet", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.deployer).setPlatform(wallets.a.address))
                .to.emit(sut, "PlatformSet")
                .withArgs(wallets.a.address);
        });
    });

    describe("setReferralReward", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.b).setReferralReward(1, 1000n))
                .to.be.revertedWithCustomError(sut, "OwnableUnauthorizedAccount")
                .withArgs(wallets.b.address);
        });

        it("Should revert if the reward rates aggregate above 100%", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.deployer).setReferralReward(0, DENOMINATOR))
                .to.be.revertedWithCustomError(sut, "InvalidValue")
                .withArgs(DENOMINATOR + 500n);
        });

        it("Should revert if adding a set creates a gap", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            // 0, 1, gap, 3
            await expect(sut.connect(wallets.deployer).setReferralReward(3, 100n))
                .to.be.revertedWithCustomError(sut, "InvalidValue")
                .withArgs(3n);
        });

        it("Should NOT revert if removing a rate creates a gap", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await sut.connect(wallets.deployer).setReferralReward(0, 100n);
            await sut.connect(wallets.deployer).setReferralReward(1, 100n);
            await sut.connect(wallets.deployer).setReferralReward(2, 100n);
            await sut.connect(wallets.deployer).setReferralReward(3, 100n);
            await sut.connect(wallets.deployer).setReferralReward(4, 100n);

            await expect(sut.connect(wallets.deployer).setReferralReward(3, 0n)).to.not.be.reverted;
        });

        it("Should set the _referralBPS", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await sut.connect(wallets.deployer).setReferralReward(1, 1000n);

            expect(await sut.getReferralReward(1)).to.equal(1000n);
        });

        it("Should emit ReferralRewardSet", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.deployer).setReferralReward(1, 1000n))
                .to.emit(sut, "ReferralRewardSet")
                .withArgs(1, 1000n);
        });
    });

    describe("setReferredBy", function () {
        it("Should revert if the referrer is the zero address", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.deployer).setReferredBy(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(sut, "InvalidAddress")
                .withArgs(ethers.ZeroAddress);
        });

        it("Should revert if the referrer is yourself", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.deployer).setReferredBy(wallets.deployer.address))
                .to.be.revertedWithCustomError(sut, "InvalidAddress")
                .withArgs(wallets.deployer.address);
        });

        it("Should revert if its cyclical", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.a).setReferredBy(wallets.d.address))
                .to.be.revertedWithCustomError(sut, "InvalidAddress")
                .withArgs(wallets.d.address);
        });

        it("Should revert if the caller was already referred", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.b).setReferredBy(wallets.a.address)).to.be.revertedWithCustomError(
                sut,
                "AlreadyReferred"
            );
        });

        it("Should set _referredBy", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await sut.connect(wallets.deployer).setReferredBy(wallets.a.address);

            expect(await sut.getReferredBy(wallets.deployer.address)).to.equal(wallets.a.address);
        });

        it("Should emit Referral", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.deployer).setReferredBy(wallets.a.address))
                .to.emit(sut, "Referral")
                .withArgs(wallets.deployer.address, wallets.a.address);
        });
    });

    describe("claimRewards", function () {
        it("Should revert if a token transfer fails", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.deployer.address, oneEther);
            await token.approve(sut.target, oneEther);

            await sut.setReferredBy(wallets.a);

            await sut.receiveFee(token.target, oneEther);

            await token.mockReturn();

            await expect(sut.connect(wallets.a).claimRewards([token.target])).to.be.revertedWithCustomError(
                sut,
                "SafeERC20FailedOperation"
            );
        });

        it("Should reset the reward to 0", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.deployer.address, oneEther);
            await token.approve(sut.target, oneEther);

            await sut.setReferredBy(wallets.a);

            await sut.receiveFee(weth.target, 0n, { value: oneEther });
            await sut.receiveFee(token.target, oneEther);

            const rewardsBefore = await sut.getRewards([token.target, weth.target], wallets.a.address);

            for (const reward of rewardsBefore) {
                expect(reward).to.be.gt(0n);
            }

            await sut.connect(wallets.a).claimRewards([token.target, weth.target]);

            const rewardsAfter = await sut.getRewards([token.target, weth.target], wallets.a.address);
            for (const reward of rewardsAfter) {
                expect(reward).to.equal(0n);
            }
        });

        it("Should emit RewardClaimed", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.deployer.address, oneEther);
            await token.approve(sut.target, oneEther);

            await sut.setReferredBy(wallets.a);

            await sut.receiveFee(weth.target, 0n, { value: oneEther });
            await sut.receiveFee(token.target, oneEther);

            const rewardsBefore = await sut.getRewards([token.target, weth.target], wallets.a.address);

            await expect(sut.connect(wallets.a).claimRewards([token.target, weth.target]))
                .to.emit(sut, "RewardClaimed")
                .withArgs(wallets.a.address, token.target, rewardsBefore[0])
                .to.emit(sut, "RewardClaimed")
                .withArgs(wallets.a.address, weth.target, rewardsBefore[1]);
        });

        it("Should ignore a token with 0 reward", async function () {
            const { sut, weth, token, wallets } = await loadFixture(fixture);

            await sut.setReferredBy(wallets.a);

            await sut.receiveFee(weth.target, 0n, { value: oneEther });

            const rewardsBefore = await sut.getRewards([token.target, weth.target], wallets.a.address);

            expect(rewardsBefore[0]).to.equal(0n); // token has no rewards
            expect(rewardsBefore[1]).to.be.gt(0n); // weth has rewards

            const tx = await sut.connect(wallets.a).claimRewards([token.target, weth.target]);
            const receipt = (await tx.wait())!;

            const iface = sut.interface;
            const rewardClaimedTopic = id("RewardClaimed(address,address,uint256)");

            const rewardClaimedEvents = receipt.logs
                .filter((log) => log.topics[0] === rewardClaimedTopic)
                .map((log) => iface.decodeEventLog("RewardClaimed", log.data, log.topics));

            expect(rewardClaimedEvents.length).to.equal(1);
            expect(rewardClaimedEvents).to.deep.include.members([[wallets.a.address, weth.target, rewardsBefore[1]]]);
        });
    });

    describe("receiveFee", function () {
        it("Should revert if the total value is zero", async function () {
            const { sut, token } = await loadFixture(fixture);

            await expect(sut.receiveFee(token.target, 0n))
                .to.be.revertedWithCustomError(sut, "InvalidValue")
                .withArgs(0n);
        });

        it("Should revert if the token is not weth but there is a msg.value", async function () {
            const { sut, token } = await loadFixture(fixture);

            await expect(
                sut.receiveFee(token.target, 0n, {
                    value: oneEther,
                })
            )
                .to.be.revertedWithCustomError(sut, "InvalidAddress")
                .withArgs(token.target);
        });

        it("Should revert if the token transfer fails", async function () {
            const { sut, token } = await loadFixture(fixture);

            await token.mockReturn();

            await expect(sut.receiveFee(token.target, oneEther)).to.be.revertedWithCustomError(
                sut,
                "SafeERC20FailedOperation"
            );
        });

        it("Should combine weth with native", async function () {
            const { sut, weth, wallets } = await loadFixture(fixture);

            const wethAmount = oneEther;
            const nativeAmount = oneEther * 2n;

            await weth.deposit({ value: wethAmount });
            await weth.approve(sut.target, wethAmount);

            await sut.receiveFee(weth.target, wethAmount, {
                value: nativeAmount,
            });

            expect(await weth.balanceOf(sut.target)).to.equal(wethAmount + nativeAmount);
            expect(await ethers.provider.getBalance(sut.target)).to.equal(0n);

            expect(await sut.getReward(weth.target, wallets.platform.address)).to.equal(wethAmount + nativeAmount);
        });

        it("Should payout 100% to the platform with 0 length referrer chain", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            await token.mint(wallets.deployer.address, oneEther);
            await token.approve(sut.target, oneEther);

            await sut.receiveFee(token.target, oneEther);

            expect(await sut.getReward(token.target, wallets.platform.address)).to.equal(oneEther);
        });

        it("Should payout 85% to the platform, 15% to the referrer for a 1 length referrer chain", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            const source = wallets.f;

            await token.mint(source.address, oneEther);
            await token.connect(source).approve(sut.target, oneEther);

            await sut.connect(source).receiveFee(token.target, oneEther);

            expect(await sut.getReward(token.target, wallets.e.address)).to.equal(
                (oneEther * 1500n) / DENOMINATOR // 15%
            );

            expect(await sut.getReward(token.target, wallets.platform.address)).to.equal(
                (oneEther * 8500n) / DENOMINATOR // 85%
            );
        });

        it("Should payout 80% to the platform, 15% to the referrer, 5% to the referrer's referrer for a 2 length referrer chain", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            const source = wallets.g;

            await token.mint(source.address, oneEther);
            await token.connect(source).approve(sut.target, oneEther);

            await sut.connect(source).receiveFee(token.target, oneEther);

            expect(await sut.getReward(token.target, wallets.e.address)).to.equal(
                (oneEther * 500n) / DENOMINATOR // 5%
            );

            expect(await sut.getReward(token.target, wallets.f.address)).to.equal(
                (oneEther * 1500n) / DENOMINATOR // 15%
            );

            expect(await sut.getReward(token.target, wallets.platform.address)).to.equal(
                (oneEther * 8000n) / DENOMINATOR // 80%
            );
        });

        it("Should payout 80% to the platform, 15% to the referrer, 5% to the referrer's referrer for a 3 length referrer chain", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            const source = wallets.h;

            await token.mint(source.address, oneEther);
            await token.connect(source).approve(sut.target, oneEther);

            await sut.connect(source).receiveFee(token.target, oneEther);

            expect(await sut.getReward(token.target, wallets.f.address)).to.equal(
                (oneEther * 500n) / DENOMINATOR // 5%
            );

            expect(await sut.getReward(token.target, wallets.g.address)).to.equal(
                (oneEther * 1500n) / DENOMINATOR // 15%
            );

            expect(await sut.getReward(token.target, wallets.platform.address)).to.equal(
                (oneEther * 8000n) / DENOMINATOR // 80%
            );
        });

        it("Should payout 0% to the platform when the referrer reward is 100%", async function () {
            const { sut, token, wallets } = await loadFixture(fixture);

            const source = wallets.f;

            await sut.connect(wallets.deployer).setReferralReward(1, 0n); // 0%
            await sut.connect(wallets.deployer).setReferralReward(0, 10000n); // 100%

            await token.mint(source.address, oneEther);
            await token.connect(source).approve(sut.target, oneEther);

            await sut.connect(source).receiveFee(token.target, oneEther);

            expect(await sut.getReward(token.target, wallets.e.address)).to.equal(oneEther); // 100%
            expect(await sut.getReward(token.target, wallets.platform.address)).to.equal(0n); // 0%
        });
    });
});
