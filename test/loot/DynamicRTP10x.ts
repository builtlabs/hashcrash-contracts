import { loadFixture, mine } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { randomBytes } from "crypto";
import { hexlify } from "ethers";
import fs from "fs";

const variableEvs = [
    95, 94.5, 94, 93.5, 92.9, 92.5, 92.3, 92.5, 92.9, 93.5, 94, 94.5, 95, 95.5, 96, 96.5, 96.9, 97, 97, 97, 97, 97, 97,
    97, 96.9, 96.5, 96, 95.5, 95.3, 95.5, 96, 96.5, 97,
];
const expectedLength = 33;

const log = true;
function logIfEnabled(...args: any[]) {
    if (log) {
        console.log(...args);
    }
}

describe("DynamicRTP10x", function () {
    async function fixture() {
        const [deployer] = await ethers.getSigners();

        const LOOT = await ethers.getContractFactory("DynamicRTP10x");
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

                expect(ev).to.equal(
                    [
                        94.8149394347241, 94.15376850605654, 93.56662180349934, 93.06022880215342, 92.21265141318977,
                        91.74798115746972, 91.52489905787348, 91.45222072678331, 92.02893674293404, 92.98183041722746,
                        93.37954239569314, 93.63391655450874, 94.721399730821, 95.74158815612381, 96.03903095558546,
                        96.56796769851951, 97.00538358008075, 97.17193808882907, 97.60430686406461, 97.78768506056528,
                        97.84656796769852, 98.05518169582771, 97.37550471063257, 96.63862718707941, 96.37954239569314,
                        96.45020188425302, 96.42664872139972, 95.64266487213997, 95.61238223418573, 94.78129205921938,
                        95.45087483176312, 95.6393001345895, 96.43337819650067,
                    ][key]
                );

                expect(ev).to.be.greaterThan(variableEvs[key] - 1.5);
                expect(ev).to.be.lessThan(variableEvs[key] + 1.5);

                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

            const expectedEv = variableEvs.reduce((acc, curr) => acc + curr, 0) / variableEvs.length;
            const averageEv = evs.reduce((acc, curr) => acc + curr, 0) / evs.length;

            expect(averageEv).to.equal(95.1493637587177);
            expect(averageEv).to.be.greaterThan(expectedEv - 1);
            expect(averageEv).to.be.lessThan(expectedEv + 1);
            logIfEnabled(`Average EV: ${averageEv} (expected: ${expectedEv})`);
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

                expect(ev).to.equal(
                    [
                        95.02563930013459, 94.38694481830417, 94.06258411843876, 93.13761776581426, 92.70524899057872,
                        92.17698519515478, 92.15477792732167, 92.14939434724091, 92.58411843876178, 92.88189771197845,
                        93.69448183041723, 94.1991924629879, 94.97308209959624, 95.67698519515477, 96.77388963660836,
                        96.86944818304171, 97.55047106325708, 97.08445491251683, 96.89771197846568, 97.1063257065949,
                        97.33512786002692, 97.66150740242261, 97.84656796769852, 97.71197846567968, 96.86406460296097,
                        96.97510094212652, 95.43741588156124, 94.83512786002692, 94.64333781965007, 96.15410497981158,
                        96.48048452220728, 96.98183041722746, 97.57738896366084,
                    ][key]
                );

                expect(ev).to.be.greaterThan(variableEvs[key] - 2.5);
                expect(ev).to.be.lessThan(variableEvs[key] + 2.5);

                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

            const expectedEv = variableEvs.reduce((acc, curr) => acc + curr, 0) / variableEvs.length;
            const averageEv = evs.reduce((acc, curr) => acc + curr, 0) / evs.length;

            expect(averageEv).to.equal(95.41197846567967);
            expect(averageEv).to.be.greaterThan(expectedEv - 1);
            expect(averageEv).to.be.lessThan(expectedEv + 1);
            logIfEnabled(`Average EV: ${averageEv} (expected: ${expectedEv})`);
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

            const iterations = 100000;
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

                const expectedEv = variableEvs[key];
                expect(ev).to.be.greaterThan(expectedEv - 2);
                expect(ev).to.be.lessThan(expectedEv + 2);

                evs.push(ev);

                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

            const expectedEv = variableEvs.reduce((acc, curr) => acc + curr, 0) / variableEvs.length;
            const averageEv = evs.reduce((acc, curr) => acc + curr, 0) / evs.length;
            expect(averageEv).to.be.greaterThan(expectedEv - 1);
            expect(averageEv).to.be.lessThan(expectedEv + 1);

            logIfEnabled(`Average EV: ${averageEv} (expected: ${expectedEv})`);
        });

        it("Should produce the expected ev locally", async function () {
            logIfEnabled("Running test locally with random large sample size...");

            const {
                local: { length, multipliers, deadOn: localDeadOn },
            } = await loadFixture(fixture);

            const iterations = 1000000;
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

                const expectedEv = variableEvs[key];
                expect(ev).to.be.greaterThan(expectedEv - 1);
                expect(ev).to.be.lessThan(expectedEv + 1);

                evs.push(ev);
                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

            const expectedEv = variableEvs.reduce((acc, curr) => acc + curr, 0) / variableEvs.length;
            const averageEv = evs.reduce((acc, curr) => acc + curr, 0) / evs.length;
            expect(averageEv).to.be.greaterThan(expectedEv - 0.5);
            expect(averageEv).to.be.lessThan(expectedEv + 0.5);

            logIfEnabled(`Average EV: ${averageEv} (expected: ${expectedEv})`);
        });
    });
});
