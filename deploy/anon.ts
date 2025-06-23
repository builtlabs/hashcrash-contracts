import { vars } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { deploy, getHash, getHashProducer, getProvider, getSalt, getWeth, tx, verifyAll } from "./helpers";
import { Deployer } from "@matterlabs/hardhat-zksync";
import { Wallet } from "zksync-ethers";
import { ethers } from "ethers";

export default async function (runtime: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script`, runtime.network.name);

    const isTestnet = runtime.network.name === "abstractTestnet";
    if (isTestnet) {
        throw new Error("This script should not be run on testnet. Use deploy/testnet.ts instead.");
    }

    const privateKey = vars.get("PK_HASHCRASH_PRIVATE");
    const seed = vars.get("SEED");

    const wallet = new Wallet(privateKey, getProvider(isTestnet));
    const deployer = new Deployer(runtime, wallet);

    const weth = getWeth(isTestnet);
    const hashProducer = getHashProducer(isTestnet);

    const dynamicRTP10x = await deploy(deployer, "DynamicRTP10x", []);

    const ethGenesisHash = getHash(getSalt(seed, 0, 0));
    const maxExposureNumerator = "100";
    const minLiquidityEth = ethers.parseEther("0.05").toString();
    const minValueEth = ethers.parseEther("0.001").toString();

    await deploy(deployer, "HashCrashNative", [
        dynamicRTP10x.target,
        ethGenesisHash,
        hashProducer,
        maxExposureNumerator,
        minLiquidityEth,
        wallet.address,
        weth,
        minValueEth,
    ]);

    await verifyAll(runtime);
}
