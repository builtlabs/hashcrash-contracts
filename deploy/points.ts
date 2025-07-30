import { vars } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getProvider, tx } from "./helpers";
import { Wallet, Contract } from "zksync-ethers";
import ERC20 from "../artifacts-zk/@openzeppelin/contracts/token/ERC20/ERC20.sol/ERC20.json";
import GrindPool from "../artifacts-zk/contracts/auxiliary/GrindRewardPool.sol/GrindRewardPool.json";
import { ethers } from "ethers";
import { SEASON_FOUR, DIRTY } from "./helpers/season-data";
import fs from "fs";

export default async function (runtime: HardhatRuntimeEnvironment) {
    // const clean = DIRTY.map((item) => {
    //     return {
    //         account: item.user,
    //         points: item.points,
    //     };
    // });

    // fs.writeFileSync("clean.json", JSON.stringify(clean, null, 2));
    // return;

    const isTestnet = runtime.network.name === "abstractTestnet";

    if (isTestnet) {
        throw new Error("This script should only be run on mainnet. Use deploy/testnet.ts for testnet deployment.");
    }

    const privateKey = vars.get("PK_HASHCRASH_PUBLIC");

    const wallet = new Wallet(privateKey, getProvider(isTestnet));

    const grind = new Contract("0x1C26DA604221466976bEeB509698152bA8A3A13F", ERC20.abi, wallet);
    const pool = new Contract("0x3889985e91c806b92BF000A374b58dAEdc7D28b5", GrindPool.abi, wallet);

    const totalGrind = ethers.parseEther("111111112");

    const seasonId = 4n;

    await tx(grind.approve(pool.target, totalGrind));
    await tx(pool.populateGrind(seasonId, totalGrind));
    await tx(pool.populatePoints(seasonId, SEASON_FOUR));
    await tx(pool.openClaim(seasonId));

    const totalPoints = SEASON_FOUR.reduce((acc, season) => acc + season.points, 0);
    console.log(`Total points for season: ${totalPoints}`);
}
