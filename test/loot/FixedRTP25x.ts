import { loadFixture, mine } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { randomBytes } from "crypto";
import { hexlify } from "ethers";
import fs from "fs";

const expectedEv = 97;
const expectedLength = 48;

const log = true;
function logIfEnabled(...args: any[]) {
    if (log) {
        console.log(...args);
    }
}

describe("FixedRTP25x", function () {
    async function fixture() {
        const [deployer] = await ethers.getSigners();

        const LOOT = await ethers.getContractFactory("FixedRTP25x");
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
                        96.65006729475103, 96.50672947510095, 96.47577388963661, 96.44986541049798, 96.25841184387617,
                        96.18102288021535, 96.17025572005385, 95.7200538358008, 95.92530282637955, 96.20188425302825,
                        95.87483176312247, 95.69313593539704, 96.33512786002693, 96.82368775235531, 96.65141318977119,
                        96.45491251682368, 96.62180349932706, 96.82200538358009, 97.18034993270525, 97.4091520861373,
                        97.22745625841185, 97.60094212651413, 96.56796769851951, 96.00942126514131, 95.69313593539704,
                        96.18775235531628, 96.56796769851952, 96.1978465679677, 96.36608344549124, 95.46769851951548,
                        95.45087483176312, 95.06393001345896, 95.49125168236877, 95.56527590847914, 95.28936742934052,
                        95.35666218034993, 94.40107671601614, 95.18842530282639, 94.32032301480484, 93.92328398384926,
                        94.48183041722746, 94.8721399730821, 94.34724091520862, 94.40107671601615, 94.75100942126514,
                        95.49798115746971, 96.09690444145356, 96.56796769851952,
                    ][key]
                );

                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

            const averageEv = evs.reduce((acc, curr) => acc + curr, 0) / evs.length;

            expect(averageEv).to.equal(95.90330585464329);
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
                        97.04427994616421, 96.87415881561239, 97.12718707940782, 96.68977119784657, 96.83176312247645,
                        96.57637954239569, 96.74764468371468, 96.53970390309556, 96.46029609690446, 96.11305518169583,
                        96.50471063257065, 96.51413189771198, 96.43876177658144, 96.62987886944818, 97.28129205921938,
                        96.92597577388963, 97.22745625841185, 96.62516823687753, 96.37954239569314, 96.52590847913864,
                        96.76985195154778, 97.1164199192463, 97.1399730820996, 97.00874831763123, 96.54104979811575,
                        96.71265141318976, 95.72005383580081, 95.79407806191116, 95.66621803499326, 96.78331090174966,
                        96.23822341857334, 96.47039030955585, 96.70255720053835, 97.19380888290713, 98.19650067294752,
                        96.9313593539704, 97.13324360699866, 96.90444145356662, 97.65814266487214, 97.46971736204576,
                        95.814266487214, 95.3835800807537, 95.69313593539704, 96.52086137281292, 96.2314939434724,
                        94.56931359353969, 93.5127860026918, 92.36204576043069,
                    ][key]
                );

                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

            const averageEv = evs.reduce((acc, curr) => acc + curr, 0) / evs.length;

            expect(averageEv).to.equal(96.46448519515475);
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

                expect(ev).to.be.greaterThan(expectedEv - 2);
                expect(ev).to.be.lessThan(expectedEv + 2);

                evs.push(ev);

                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

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

                expect(ev).to.be.greaterThan(expectedEv - 1);
                expect(ev).to.be.lessThan(expectedEv + 1);

                evs.push(ev);
                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

            const averageEv = evs.reduce((acc, curr) => acc + curr, 0) / evs.length;
            expect(averageEv).to.be.greaterThan(expectedEv - 0.5);
            expect(averageEv).to.be.lessThan(expectedEv + 0.5);

            logIfEnabled(`Average EV: ${averageEv} (expected: ${expectedEv})`);
        });
    });
});
