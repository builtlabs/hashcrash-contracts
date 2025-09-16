import { loadFixture, mine } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { randomBytes } from "crypto";
import { hexlify } from "ethers";
import fs from "fs";

const expectedEv = 97;
const expectedLength = 33;

const log = true;
function logIfEnabled(...args: any[]) {
    if (log) {
        console.log(...args);
    }
}

describe("FixedRTP10x", function () {
    async function fixture() {
        const [deployer] = await ethers.getSigners();

        const LOOT = await ethers.getContractFactory("FixedRTP10x");
        const loot = await LOOT.deploy();
        await loot.waitForDeployment();

        const HARNESS = await ethers.getContractFactory("LootTableHarness");
        const harness = await HARNESS.deploy(loot.target);
        await harness.waitForDeployment();

        const length = await loot.getLength();
        expect(length).to.equal(expectedLength);

        const multipliers = await loot.getMultipliers();
        expect(multipliers.length).to.equal(expectedLength);

        const probabilities = await loot.getProbabilities();
        expect(probabilities.length).to.equal(expectedLength);

        function deadOn(rng: bigint[]) {
            const lengthN = Number(length);

            for (let i = 0; i < lengthN; i++) {
                if (rng[i] % BigInt(1e18) < probabilities[i]) {
                    return i;
                }
            }
            return lengthN;
        }

        return {
            harness,
            loot,
            wallet: deployer,

            local: {
                length: expectedLength,
                multipliers: multipliers.map((x) => Number(x) / 1e6),
                probabilities,
                deadOn,
            },
        };
    }

    // ############################ TESTS ############################

    // NOTE: Despite taking around 750k block hashes, this is a tiny sample size, so only checking the average
    describe("abstract block hashes", function () {
        it("Average EV should be around expected for raw block hashes", async function () {
            logIfEnabled("Running test with raw block hashes...");

            const {
                harness,
                local: { multipliers },
            } = await loadFixture(fixture);

            const precomputed = JSON.parse(
                fs.readFileSync("test/_helpers/rawBlockHashes.json", "utf-8"),
                (_key, value) => {
                    if (typeof value === "string" && /^\d+$/.test(value)) {
                        try {
                            return BigInt(value);
                        } catch {
                            return value;
                        }
                    }
                    return value;
                }
            ) as bigint[][];

            const visits = new Map<number, number>();

            for (const rng of precomputed) {
                const deadOn = await harness.deadOn(rng);
                for (let j = 0; j < deadOn; j++) {
                    const current = visits.get(j) ?? 0;
                    visits.set(j, current + 1);
                }
            }

            const evs: number[] = [];

            for (const [key, value] of visits) {
                const ev = (value / precomputed.length) * multipliers[key] * 100;
                evs.push(ev);

                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

            const averageEv = evs.reduce((acc, curr) => acc + curr, 0) / evs.length;

            expect(averageEv).to.equal(96.3120641135446);

            logIfEnabled(`Average EV: ${averageEv}`);
        });

        it("Average EV should be around expected for salted block hashes", async function () {
            logIfEnabled("Running test with salted block hashes...");

            const {
                harness,
                local: { multipliers },
            } = await loadFixture(fixture);

            const precomputed = JSON.parse(
                fs.readFileSync("test/_helpers/saltedBlockHashes.json", "utf-8"),
                (_key, value) => {
                    if (typeof value === "string" && /^\d+$/.test(value)) {
                        try {
                            return BigInt(value);
                        } catch {
                            return value;
                        }
                    }
                    return value;
                }
            ) as bigint[][];

            const visits = new Map<number, number>();

            for (const rng of precomputed) {
                const deadOn = await harness.deadOn(rng);
                for (let j = 0; j < deadOn; j++) {
                    const current = visits.get(j) ?? 0;
                    visits.set(j, current + 1);
                }
            }

            const evs: number[] = [];

            for (const [key, value] of visits) {
                const ev = (value / precomputed.length) * multipliers[key] * 100;
                evs.push(ev);

                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

            const averageEv = evs.reduce((acc, curr) => acc + curr, 0) / evs.length;

            expect(averageEv).to.equal(96.62789673314569);

            logIfEnabled(`Average EV: ${averageEv}`);
        });
    });

    // NOTE: This test is slow (about 20-30 minutes), so it's skipped by default.
    describe.skip("random large sample size (SLOW, remove skip to run)", function () {
        it("Should produce the expected ev on chain", async function () {
            logIfEnabled("Running test on chain with random large sample size...");

            const {
                harness,
                local: { length, multipliers },
            } = await loadFixture(fixture);

            const iterations = 500000;
            const visits = new Map<number, number>();

            for (let i = 0; i < iterations; i++) {
                const rng = Array.from({ length }, () => BigInt(hexlify(randomBytes(32))));

                const deadOn = await harness.deadOn(rng);
                for (let j = 0; j < deadOn; j++) {
                    const current = visits.get(j) ?? 0;
                    visits.set(j, current + 1);
                }
            }

            const evs: number[] = [];

            for (const [key, value] of visits) {
                const ev = (value / iterations) * multipliers[key] * 100;

                expect(ev).to.be.greaterThan(expectedEv - 2);
                expect(ev).to.be.lessThan(expectedEv + 2);

                evs.push(ev);

                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

            const averageEv = evs.reduce((acc, curr) => acc + curr, 0) / evs.length;
            expect(averageEv).to.be.greaterThan(expectedEv - 1);
            expect(averageEv).to.be.lessThan(expectedEv + 1);

            logIfEnabled(`Average EV: ${averageEv}`);
        });

        it("Should produce the expected ev locally", async function () {
            logIfEnabled("Running test locally with random large sample size...");

            const {
                local: { length, multipliers, deadOn: localDeadOn },
            } = await loadFixture(fixture);

            const iterations = 5000000;
            const visits = new Map<number, number>();

            for (let i = 0; i < iterations; i++) {
                const rng = Array.from({ length }, () => BigInt(hexlify(randomBytes(32))));

                const deadOn = localDeadOn(rng);
                for (let j = 0; j < deadOn; j++) {
                    const current = visits.get(j) ?? 0;
                    visits.set(j, current + 1);
                }
            }

            const evs: number[] = [];

            for (const [key, value] of visits) {
                const ev = (value / iterations) * multipliers[key] * 100;

                expect(ev).to.be.greaterThan(expectedEv - 1);
                expect(ev).to.be.lessThan(expectedEv + 1);

                evs.push(ev);
                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

            const averageEv = evs.reduce((acc, curr) => acc + curr, 0) / evs.length;
            expect(averageEv).to.be.greaterThan(expectedEv - 0.5);
            expect(averageEv).to.be.lessThan(expectedEv + 0.5);

            logIfEnabled(`Average EV: ${averageEv}`);
        });
    });
});
