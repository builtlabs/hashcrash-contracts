import { loadFixture, mine } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { randomBytes } from "crypto";
import { hexlify } from "ethers";
import fs from "fs";

const variableEvs = [
    95, 95, 95, 95, 95, 95, 95, 95.5, 96, 96.5, 96.75, 97, 97, 97, 97, 97, 97, 97, 97, 97, 97, 97, 97, 96.5, 96, 95.5,
    95.25, 95, 95.25, 95.5, 96, 96.5, 97,
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
                        94.8149394347241, 94.67664872139974, 94.63257065948856, 94.60026917900403, 94.3849259757739,
                        94.28835800807538, 94.27187079407805, 94.40107671601614, 95.12786002691789, 95.9242934051144,
                        95.82637954239569, 95.84118438761776, 96.4091520861373, 96.90444145356662, 96.75639300134591,
                        96.53028263795423, 96.70255720053837, 96.82200538358009, 97.20390309555856, 97.4091520861373,
                        97.28129205921938, 97.57065948855988, 96.70255720053835, 95.41722745625842, 94.64333781965007,
                        94.56931359353972, 94.8250336473755, 94.2799461641992, 94.75100942126514, 93.92328398384926,
                        94.23956931359353, 94.42462987886945, 94.81830417227457,
                    ][key]
                );

                expect(ev).to.be.greaterThan(variableEvs[key] - 2.5);
                expect(ev).to.be.lessThan(variableEvs[key] + 2.5);

                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

            const expectedEv = variableEvs.reduce((acc, curr) => acc + curr, 0) / variableEvs.length;
            const averageEv = evs.reduce((acc, curr) => acc + curr, 0) / evs.length;

            expect(averageEv).to.equal(95.48407357559448);
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
                        95.02563930013459, 94.8391655450875, 95.09892328398386, 94.69313593539702, 94.83714670255719,
                        94.59118438761777, 94.7792732166891, 95.05114401076715, 95.53162853297444, 95.69111709286673,
                        96.3835800807537, 96.46029609690444, 96.46837146702558, 96.69448183041722, 97.35127860026918,
                        96.9636608344549, 97.20726783310903, 96.64703903095558, 96.30888290713324, 96.60161507402422,
                        96.79676985195155, 97.17698519515477, 97.1736204576043, 96.71265141318976, 95.32974427994615,
                        95.26917900403768, 94.07133243606998, 93.87617765814265, 93.94347240915208, 95.46769851951548,
                        95.57200538358008, 95.95895020188425, 96.63526244952894,
                    ][key]
                );

                expect(ev).to.be.greaterThan(variableEvs[key] - 2.5);
                expect(ev).to.be.lessThan(variableEvs[key] + 2.5);

                logIfEnabled(`Multiplier: ${multipliers[key]} Visits: ${value}, EV: ${ev}`);
            }

            const expectedEv = variableEvs.reduce((acc, curr) => acc + curr, 0) / variableEvs.length;
            const averageEv = evs.reduce((acc, curr) => acc + curr, 0) / evs.length;

            expect(averageEv).to.equal(95.79420245523877);
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
