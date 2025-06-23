import { vars } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    deploy,
    getHash,
    getHashProducer,
    getPlatformFeeCollector,
    getProvider,
    getSalt,
    getWeth,
    tx,
    verifyAll,
} from "./helpers";
import { Wallet } from "zksync-ethers";
import { Deployer } from "@matterlabs/hardhat-zksync";
import { ethers } from "ethers";

export default async function (runtime: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script`, runtime.network.name);

    const isTestnet = runtime.network.name === "abstractTestnet";
    if (!isTestnet) {
        throw new Error(
            "This script should only be run on testnet. Use deploy/anon.ts or deploy/public.ts for mainnet."
        );
    }

    const privateKey = vars.get("DEV_PRIVATE_KEY");
    const seed = vars.get("DEV_SEED");

    const wallet = new Wallet(privateKey, getProvider(isTestnet));
    const deployer = new Deployer(runtime, wallet);

    const weth = getWeth(isTestnet);
    const hashProducer = getHashProducer(isTestnet);
    const feeCollector = getPlatformFeeCollector(isTestnet);

    const platform = await deploy(deployer, "PlatformInterface", [feeCollector, weth, wallet.address]);
    const lootTable = await deploy(deployer, "DynamicRTP10x", []);
    const token = await deploy(deployer, "DemoERC20", []);
    const gamemodes = [];

    const maxExposureNumerator = "1000";

    const ethGenesisHash = getHash(getSalt(seed, 0, 0));
    const minLiquidityEth = ethers.parseEther("0.05").toString();
    const minValueEth = ethers.parseEther("0.001").toString();
    const hashcrashWeth = await deploy(deployer, "HashCrashNative", [
        lootTable.target,
        ethGenesisHash,
        hashProducer,
        maxExposureNumerator,
        minLiquidityEth,
        wallet.address,
        weth,
        minValueEth,
    ]);

    await tx(hashcrashWeth.deposit("0", { value: ethers.parseEther("1") }));
    await tx(hashcrashWeth.setActive(true));
    gamemodes.push(hashcrashWeth.target);

    const grindGenesisHash = getHash(getSalt(seed, 1, 0));
    const minLiquidityGrind = ethers.parseEther("100").toString();
    const minValueGrind = ethers.parseEther("25").toString();
    const hashcrashGrind = await deploy(deployer, "HashCrashERC20", [
        lootTable.target,
        grindGenesisHash,
        hashProducer,
        maxExposureNumerator,
        minLiquidityGrind,
        wallet.address,
        token.target,
        minValueGrind,
    ]);

    const initialBalance = ethers.parseEther("777777777");
    await tx(token.mint(wallet.address, initialBalance));
    await tx(token.approve(await hashcrashGrind.getAddress(), initialBalance));
    await tx(hashcrashGrind.deposit(initialBalance));
    await tx(hashcrashGrind.setActive(true));
    gamemodes.push(hashcrashGrind.target);

    await tx(platform.startSeason(gamemodes));

    await verifyAll(runtime);
}
