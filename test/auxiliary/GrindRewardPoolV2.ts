import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

const oneEther = ethers.parseEther("1");
const tokenBalance = ethers.parseEther("10000");

describe.only("GrindRewardPoolV2", function () {
    async function fixture() {
        const [deployer, alice, bob] = await ethers.getSigners();

        const TOKEN = await ethers.getContractFactory("MockERC20");
        const token = await TOKEN.deploy();
        await token.waitForDeployment();

        const VRF = await ethers.getContractFactory("MockVRFSystem");
        const vrf = await VRF.deploy();
        await vrf.waitForDeployment();

        const SUT = await ethers.getContractFactory("GrindRewardPoolV2");
        const sut = await SUT.deploy(vrf.target, token.target, deployer.address);
        await sut.waitForDeployment();

        return {
            sut,
            vrf,
            token,
            wallets: {
                deployer,
                alice,
                bob,
            },
        };
    }

    async function fixtureWithTokens() {
        const baseFixture = await fixture();

        const { sut, token } = baseFixture;

        await token.mint(sut.target, tokenBalance);

        return {
            ...baseFixture,
        };
    }

    async function fixtureWithTickets() {
        const baseFixture = await fixtureWithTokens();

        const { sut } = baseFixture;

        const tickets = Array.from({ length: 10 }, (_, i) => {
            let hexString = BigInt(i + 1)
                .toString(16)
                .padStart(40, "0");

            hexString = ethers.getAddress("0x" + hexString);

            return { account: hexString, amount: 10 };
        });

        await sut.storeTickets(tickets);

        return {
            ...baseFixture,
            tickets,
        };
    }

    async function fixtureWithRequest() {
        const baseFixture = await fixtureWithTickets();

        const { sut, vrf } = baseFixture;

        const requestId = await vrf.getNextRequestId();
        await sut.requestLottoDraw(oneEther);

        return {
            ...baseFixture,
            requestId,
        };
    }

    // ############################ TESTS ############################

    describe("constructor", function () {
        it("Should start the next lottoId at 1", async function () {
            const { sut, vrf } = await loadFixture(fixture);

            expect(await sut.nextLottoId()).to.equal(1);
        });

        it("Should set the vrf address", async function () {
            const { sut, vrf } = await loadFixture(fixture);

            expect(await sut.vrfSystem()).to.equal(vrf.target);
        });

        it("Should set the grind address", async function () {
            const { sut, token } = await loadFixture(fixture);

            expect(await sut.grind()).to.equal(token.target);
        });

        it("Should set the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            expect(await sut.owner()).to.equal(wallets.deployer.address);
        });
    });

    describe("sendKickbacks", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixtureWithTokens);

            const kickbacks = [
                { account: wallets.deployer.address, amount: oneEther },
                { account: wallets.alice.address, amount: oneEther },
                { account: wallets.bob.address, amount: oneEther },
            ];

            await expect(sut.connect(wallets.alice).sendKickbacks(kickbacks)).to.be.revertedWithCustomError(
                sut,
                "UnauthorizedRequest"
            );
        });

        it("Should revert if a transfer fails", async function () {
            const { sut, token, wallets } = await loadFixture(fixtureWithTokens);

            const kickbacks = [
                { account: wallets.deployer.address, amount: oneEther },
                { account: wallets.alice.address, amount: oneEther },
                { account: wallets.bob.address, amount: tokenBalance },
            ];

            await expect(sut.sendKickbacks(kickbacks)).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });

        it("Should transfer all the funds", async function () {
            const { sut, wallets, token } = await loadFixture(fixtureWithTokens);

            const kickbacks = [
                { account: wallets.deployer.address, amount: oneEther },
                { account: wallets.alice.address, amount: oneEther },
                { account: wallets.bob.address, amount: oneEther },
            ];

            await sut.sendKickbacks(kickbacks);

            expect(await token.balanceOf(wallets.deployer.address)).to.equal(oneEther);
            expect(await token.balanceOf(wallets.alice.address)).to.equal(oneEther);
            expect(await token.balanceOf(wallets.bob.address)).to.equal(oneEther);
            expect(await token.balanceOf(sut.target)).to.equal(tokenBalance - oneEther * 3n);
        });

        it("Should allow for at least 256 registrations", async function () {
            const { sut, token } = await loadFixture(fixtureWithTokens);

            const kickbacks = Array.from({ length: 256 }, (_, i) => {
                let hexString = BigInt(i + 1)
                    .toString(16)
                    .padStart(40, "0");

                hexString = ethers.getAddress("0x" + hexString);

                return { account: hexString, amount: oneEther };
            });

            await sut.sendKickbacks(kickbacks);

            for (const kickback of kickbacks) {
                expect(await token.balanceOf(kickback.account)).to.equal(oneEther);
            }

            expect(await token.balanceOf(sut.target)).to.equal(tokenBalance - oneEther * 256n);
        });

        it("Should emit KickbackSent for each kickback", async function () {
            const { sut, wallets } = await loadFixture(fixtureWithTokens);

            const kickbacks = [
                { account: wallets.deployer.address, amount: oneEther },
                { account: wallets.alice.address, amount: oneEther },
                { account: wallets.bob.address, amount: oneEther },
            ];

            await expect(sut.sendKickbacks(kickbacks))
                .to.emit(sut, "KickbackSent")
                .withArgs(wallets.deployer.address, oneEther)
                .to.emit(sut, "KickbackSent")
                .withArgs(wallets.alice.address, oneEther)
                .to.emit(sut, "KickbackSent")
                .withArgs(wallets.bob.address, oneEther);
        });
    });

    describe("storeTickets", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const tickets = [
                { account: wallets.deployer.address, amount: 1 },
                { account: wallets.alice.address, amount: 1 },
                { account: wallets.bob.address, amount: 1 },
            ];

            await expect(sut.connect(wallets.alice).storeTickets(tickets)).to.be.revertedWithCustomError(
                sut,
                "UnauthorizedRequest"
            );
        });

        it("Should start the cumulative from 0", async function () {
            const { sut, wallets } = await loadFixture(fixture);
        
            const lottoId = await sut.nextLottoId();

            expect(await sut.getTotalTickets(lottoId)).to.equal(0n);

            const tickets = [
                { account: wallets.deployer.address, amount: 1 },
                { account: wallets.alice.address, amount: 1 },
                { account: wallets.bob.address, amount: 1 },
            ];

            await sut.storeTickets(tickets);

            const stored = await sut.getLottoTickets(lottoId);
            expect(stored.length).to.equal(tickets.length);

            for (let i = 0; i < tickets.length; i++) {
                expect(stored[i].user).to.equal(tickets[i].account);
                expect(stored[i].amount).to.equal(tickets[i].amount);
                expect(stored[i].cumulative).to.equal(i + 1);
            }
        });

        it("Should start the cumulative from the previous value", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const tickets = [
                { account: wallets.deployer.address, amount: 1 },
                { account: wallets.alice.address, amount: 1 },
                { account: wallets.bob.address, amount: 1 },
            ];

            await sut.storeTickets(tickets);
            await sut.storeTickets(tickets);

            const lottoId = await sut.nextLottoId();
            const stored = await sut.getLottoTickets(lottoId);
            expect(stored.length).to.equal(tickets.length * 2);

            for (let i = 0; i < tickets.length; i++) {
                expect(stored[i].user).to.equal(tickets[i].account);
                expect(stored[i].amount).to.equal(tickets[i].amount);
                expect(stored[i].cumulative).to.equal(i + 1);
            }

            for (let i = tickets.length; i < tickets.length * 2; i++) {
                expect(stored[i].user).to.equal(tickets[i - tickets.length].account);
                expect(stored[i].amount).to.equal(tickets[i - tickets.length].amount);
                expect(stored[i].cumulative).to.equal(i + 1);
            }
        });

        it("Should allow for at least 256 registrations", async function () {
            const { sut } = await loadFixture(fixture);

            const tickets = Array.from({ length: 256 }, (_, i) => {
                let hexString = BigInt(i + 1)
                    .toString(16)
                    .padStart(40, "0");

                hexString = ethers.getAddress("0x" + hexString);

                return { account: hexString, amount: 1 };
            });

            await sut.storeTickets(tickets);

            const lottoId = await sut.nextLottoId();
            const stored = await sut.getLottoTickets(lottoId);
            for (let i = 0; i < tickets.length; i++) {
                expect(stored[i].user).to.equal(tickets[i].account);
                expect(stored[i].amount).to.equal(tickets[i].amount);
                expect(stored[i].cumulative).to.equal(i + 1);
            }
        });

        it("Should emit LottoTicketsStored for each ticket", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            const lottoId = await sut.nextLottoId();

            const tickets = [
                { account: wallets.deployer.address, amount: 1 },
                { account: wallets.alice.address, amount: 1 },
                { account: wallets.bob.address, amount: 1 },
            ];

            await expect(sut.storeTickets(tickets))
                .to.emit(sut, "LottoTicketsStored")
                .withArgs(lottoId, 1, 1, wallets.deployer.address)
                .to.emit(sut, "LottoTicketsStored")
                .withArgs(lottoId, 1, 2, wallets.alice.address)
                .to.emit(sut, "LottoTicketsStored")
                .withArgs(lottoId, 1, 3, wallets.bob.address);
        });
    });

    describe("requestLottoDraw", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixtureWithTickets);

            await expect(sut.connect(wallets.alice).requestLottoDraw(oneEther)).to.be.revertedWithCustomError(
                sut,
                "UnauthorizedRequest"
            );
        });

        it("Should revert if the reward is 0", async function () {
            const { sut } = await loadFixture(fixtureWithTickets);

            await expect(sut.requestLottoDraw(0n)).to.be.revertedWithCustomError(sut, "InvalidRewardAmount");
        });

        it("Should revert if there are no tickets for the lotto", async function () {
            const { sut } = await loadFixture(fixture);

            await expect(sut.requestLottoDraw(oneEther)).to.be.revertedWithCustomError(sut, "NoTicketsForLotto");
        });

        it("Should request a random number", async function () {
            const { sut, vrf } = await loadFixture(fixtureWithTickets);

            const traceId = await sut.nextLottoId();
            const nextRequestId = await vrf.getNextRequestId();

            await expect(sut.requestLottoDraw(oneEther))
                .to.emit(vrf, "RandomNumberRequested")
                .withArgs(nextRequestId, traceId);
        });

        it("Should store the lotto request against the request id", async function () {
            const { sut, vrf } = await loadFixture(fixtureWithTickets);

            const traceId = await sut.nextLottoId();
            const nextRequestId = await vrf.getNextRequestId();

            await sut.requestLottoDraw(oneEther);

            const lottoRequest = await sut.requestIdToLotto(nextRequestId);
            expect(lottoRequest.lottoId).to.equal(traceId);
            expect(lottoRequest.reward).to.equal(oneEther);
        });

        it("Should increment next lotto id", async function () {
            const { sut, vrf } = await loadFixture(fixtureWithTickets);

            const nextLottoId = await sut.nextLottoId();

            await sut.requestLottoDraw(oneEther);

            expect(await sut.nextLottoId()).to.equal(nextLottoId + 1n);
        });

        it("Should emit LottoDrawRequested", async function () {
            const { sut, vrf } = await loadFixture(fixtureWithTickets);

            const traceId = await sut.nextLottoId();
            const nextRequestId = await vrf.getNextRequestId();

            await expect(sut.requestLottoDraw(oneEther))
                .to.emit(sut, "LottoDrawRequested")
                .withArgs(traceId, nextRequestId, oneEther);
        });
    });

    describe("randomNumberCallback", function () {
        it("Should revert if the caller is not the vrf system", async function () {
            const { sut, wallets } = await loadFixture(fixtureWithRequest);

            await expect(sut.connect(wallets.alice).randomNumberCallback(1n, 1n)).to.be.revertedWithCustomError(
                sut,
                "UnauthorizedRequest"
            );
        });

        it("Should revert if the request is not tied to a lotto", async function () {
            const { sut, vrf } = await loadFixture(fixtureWithRequest);

            const randomNumber = 1n;

            await expect(vrf.fulfillRandomNumber(0n, randomNumber, sut.target)).to.be.revertedWithCustomError(
                sut,
                "LottoNotFound"
            );
        });

        it("Should delete the lotto request", async function () {
            const { sut, vrf, requestId } = await loadFixture(fixtureWithRequest);

            const randomNumber = 1n;

            await vrf.fulfillRandomNumber(requestId, randomNumber, sut.target);

            const lottoRequest = await sut.requestIdToLotto(requestId);
            expect(lottoRequest.lottoId).to.equal(0n);
            expect(lottoRequest.reward).to.equal(0n);
        });

        it("should find the winner when they are the first ticket", async function () {
            const { sut, vrf, token, tickets, requestId } = await loadFixture(fixtureWithRequest);

            const nextLotto = await sut.requestIdToLotto(requestId);

            const randomNumber = 1n;

            await expect(vrf.fulfillRandomNumber(requestId, randomNumber, sut.target))
                .to.emit(sut, "LottoDrawCompleted")
                .withArgs(nextLotto.lottoId, requestId, randomNumber, nextLotto.reward, tickets[0].account);

            expect(await token.balanceOf(tickets[0].account)).to.equal(nextLotto.reward);
        });

        it("should find the winner when they are a middle ticket", async function () {
            const { sut, vrf, token, tickets, requestId } = await loadFixture(fixtureWithRequest);

            const nextLotto = await sut.requestIdToLotto(requestId);
            const totalTickets = await sut.getTotalTickets(nextLotto.lottoId);

            const randomNumber = totalTickets / 2n - 1n; // Middle ticket

            await expect(vrf.fulfillRandomNumber(requestId, randomNumber, sut.target))
                .to.emit(sut, "LottoDrawCompleted")
                .withArgs(nextLotto.lottoId, requestId, randomNumber, nextLotto.reward, tickets[4].account);

            expect(await token.balanceOf(tickets[4].account)).to.equal(nextLotto.reward);
        });

        it("should find the winner when they are the last ticket", async function () {
            const { sut, vrf, token, tickets, requestId } = await loadFixture(fixtureWithRequest);

            const nextLotto = await sut.requestIdToLotto(requestId);
            const totalTickets = await sut.getTotalTickets(nextLotto.lottoId);

            const randomNumber = totalTickets - 1n; // Last ticket

            await expect(vrf.fulfillRandomNumber(requestId, randomNumber, sut.target))
                .to.emit(sut, "LottoDrawCompleted")
                .withArgs(nextLotto.lottoId, requestId, randomNumber, nextLotto.reward, tickets[9].account);

            expect(await token.balanceOf(tickets[9].account)).to.equal(nextLotto.reward);
        });

        it("should find the winner from ticket 0 to 9", async function () {
            for (let i = 0; i < 100; i++) {
                const { sut, vrf, token, tickets, requestId } = await loadFixture(fixtureWithRequest);

                const nextLotto = await sut.requestIdToLotto(requestId);

                const randomNumber = BigInt(i);
                const expectedWinner = tickets[Math.floor(i / 10)].account;

                await expect(vrf.fulfillRandomNumber(requestId, randomNumber, sut.target))
                    .to.emit(sut, "LottoDrawCompleted")
                    .withArgs(nextLotto.lottoId, requestId, randomNumber, nextLotto.reward, expectedWinner);

                expect(await token.balanceOf(expectedWinner)).to.equal(nextLotto.reward);
            }
        });
    });
});
