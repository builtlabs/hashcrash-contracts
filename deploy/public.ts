import { vars } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { deploy, getPlatformFeeCollector, getProvider, getWeth, verifyAll } from "./helpers";
import { Wallet } from "zksync-ethers";
import { Deployer } from "@matterlabs/hardhat-zksync";

export default async function (runtime: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script`, runtime.network.name);

    const isTestnet = runtime.network.name === "abstractTestnet";

    if (isTestnet) {
        throw new Error("This script should only be run on mainnet. Use deploy/testnet.ts for testnet deployment.");
    }

    const privateKey = vars.get("PK_HASHCRASH_PUBLIC");

    const wallet = new Wallet(privateKey, getProvider(isTestnet));
    const deployer = new Deployer(runtime, wallet);

    const weth = getWeth(isTestnet);
    const feeCollector = getPlatformFeeCollector(isTestnet);

    await deploy(deployer, "PlatformInterface", [feeCollector, weth, wallet.address]);
    await deploy(deployer, "GeneralPaymaster", [wallet.address]);

    await verifyAll(runtime);
}
