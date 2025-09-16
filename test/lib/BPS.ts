import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("BPS", function () {
    async function fixture() {
        const SUT = await ethers.getContractFactory("BPSWrapper");
        const sut = await SUT.deploy();
        await sut.waitForDeployment();

        return sut;
    }

    // ############################ TESTS ############################

    describe("calculate", function () {
        it("Should allow zero bps", async function () {
            const sut = await loadFixture(fixture);

            expect(await sut.calculate(1000n, 0n)).to.equal(0n);
        });

        it("Should allow zero value", async function () {
            const sut = await loadFixture(fixture);

            expect(await sut.calculate(0n, 1000n)).to.equal(0n);
        });

        it("Should allow double zero", async function () {
            const sut = await loadFixture(fixture);

            expect(await sut.calculate(0n, 0n)).to.equal(0n);
        });

        it("Should allow full range", async function () {
            const sut = await loadFixture(fixture);

            expect(await sut.calculate(1000n, 10000n)).to.equal(1000n);
        });

        it("Should compute common rates correctly", async function () {
            const sut = await loadFixture(fixture);
            expect(await sut.calculate(1000n, 250n)).to.equal(25n); // 2.5%
            expect(await sut.calculate(1234n, 1500n)).to.equal(185n); // 15% floor(185.1)=185
            expect(await sut.calculate(9999n, 1n)).to.equal(0n); // rounds down
            expect(await sut.calculate(10_001n, 1n)).to.equal(1n); // smallest non-zero
        });

        it("Should handle large amounts", async function () {
            const sut = await loadFixture(fixture);
            const amount = 2n ** 128n - 1n;
            const bps = 9999n;
            const expected = (amount * bps) / 10000n;
            expect(await sut.calculate(amount, bps)).to.equal(expected);
        });
    });

    describe("reverse", function () {
        it("Should handle zeroes", async function () {
            const sut = await loadFixture(fixture);
            expect(await sut.reverse(0n, 0n)).to.equal(0n);
            expect(await sut.reverse(0n, 5000n)).to.equal(0n);
        });

        it("0 bps means identity", async function () {
            const sut = await loadFixture(fixture);
            expect(await sut.reverse(123456n, 0n)).to.equal(123456n);
        });

        it("100% bps halves (floors) the amount", async function () {
            const sut = await loadFixture(fixture);

            expect(await sut.reverse(1001n, 10_000n)).to.equal(500n);
            expect(await sut.reverse(1000n, 10_000n)).to.equal(500n);
        });

        it("Should invert a grossed value tightly (±1 on the net)", async function () {
            const sut = await loadFixture(fixture);
            const base = 1000n;
            const bps = 500n;
            const gross = base + (await sut.calculate(base, bps));
            const net = await sut.reverse(gross, bps);
            expect(net === base || net + 1n === base).to.equal(true);
        });

        it("Monotonic: higher gross yields >= reverse", async function () {
            const sut = await loadFixture(fixture);
            const bps = 321n;
            const net1 = await sut.reverse(10_000n, bps);
            const net2 = await sut.reverse(10_001n, bps);
            expect(net2).to.be.gte(net1);
        });

        it("Edge bps values behave", async function () {
            const sut = await loadFixture(fixture);
            const amount = 123456789n;
            expect(await sut.reverse(amount, 1n)).to.equal((amount * 10000n) / (10000n + 1n));
            expect(await sut.reverse(amount, 9999n)).to.equal((amount * 10000n) / (10000n + 9999n));
        });

        it("Round-trip: base → gross → reverse is base or base-1", async function () {
            const sut = await loadFixture(fixture);
            const pairs: Array<[bigint, bigint]> = [
                [1n, 1n],
                [10n, 333n],
                [1234n, 1500n],
                [9999n, 1n],
                [1_000_000n, 7777n],
            ];
            for (const [base, bps] of pairs) {
                const gross = base + (await sut.calculate(base, bps));
                const net = await sut.reverse(gross, bps);
                expect(net === base || net + 1n === base, `base=${base} bps=${bps}`).to.equal(true);
            }
        });
    });

    describe("fuzz", function () {
        it("Should reverse vs add-bps round-trip bound", async function () {
            const sut = await loadFixture(fixture);

            for (let i = 0; i < 10_000; i++) {
                const base = ethers.toBigInt(ethers.randomBytes(8)) % 2n ** 64n;
                const bps = BigInt(Number(ethers.toBigInt(ethers.randomBytes(2))) % 10001); // 0..10000

                const gross = base + (await sut.calculate(base, bps));
                const net = await sut.reverse(gross, bps);
                const regross = net + (await sut.calculate(net, bps));

                expect(regross).to.be.at.most(gross);
                const diff = gross - regross;
                expect(diff).to.be.lte(2n);
            }
        });

        it("Reverse is non-increasing in bps for fixed amount", async function () {
            const sut = await loadFixture(fixture);
            const amount = ethers.toBigInt(ethers.randomBytes(6));
            let prev = await sut.reverse(amount, 0n);
            for (let b = 1n; b <= 10_000n; b += 137n) {
                const cur = await sut.reverse(amount, b);
                expect(cur).to.be.at.most(prev);
                prev = cur;
            }
        });
    });
});
