import { vars } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    deploy,
    deployUpgradeable,
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

    const pengu = await deploy(deployer, "DemoERC20", []);
    const grind = await deploy(deployer, "DemoERC20", []);

    const liquidity = await deploy(deployer, "CrossAppLiquidity", [
        wallet.address,
        weth,
        hashProducer,
        feeCollector,
        feeCollector,
    ]);

    const platform = await deployUpgradeable(deployer, "PlatformUpgradeableV1", [feeCollector, weth], [wallet.address]);

    const genesisHash = getHash(getSalt(seed, 0, 0));

    const crash = await deployUpgradeable(
        deployer,
        "CrashUpgradeableV1",
        [platform.target, hashProducer, liquidity.target],
        [genesisHash, wallet.address]
    );

    await tx(
        platform.setMinimums([
            {
                game: crash.target,
                token: weth,
                amount: ethers.parseEther("0.001"),
            },
            {
                game: crash.target,
                token: pengu.target,
                amount: ethers.parseEther("1000"),
            },
            {
                game: crash.target,
                token: grind.target,
                amount: ethers.parseEther("100000"),
            },
        ])
    );

    await tx(
        liquidity.setMultipleTokenSettings([
            {
                token: weth,
                settings: {
                    enabled: true,
                    feeBps: 50,
                    bufferBps: 500,
                    maxExposureBps: 100,
                    minShareValue: ethers.parseEther("0.001"),
                },
            },

            {
                token: pengu.target,
                settings: {
                    enabled: true,
                    feeBps: 50,
                    bufferBps: 500,
                    maxExposureBps: 100,
                    minShareValue: ethers.parseEther("1000"),
                },
            },

            {
                token: grind.target,
                settings: {
                    enabled: true,
                    feeBps: 50,
                    bufferBps: 500,
                    maxExposureBps: 100,
                    minShareValue: ethers.parseEther("100000"),
                },
            },
        ])
    );

    await tx(
        liquidity.setAccessLevels([
            { addr: crash.target, value: 2 },
            { addr: platform.target, value: 1 },
        ])
    );

    const penguBalance = ethers.parseEther("1000000");
    await tx(pengu.mint(wallet.address, penguBalance));
    await tx(pengu.approve(await liquidity.getAddress(), penguBalance));
    await tx(liquidity.deposit(pengu.target, penguBalance));

    const grindBalance = ethers.parseEther("100000000");
    await tx(grind.mint(wallet.address, grindBalance));
    await tx(grind.approve(await liquidity.getAddress(), grindBalance));
    await tx(liquidity.deposit(grind.target, grindBalance));

    await verifyAll(runtime);
}
