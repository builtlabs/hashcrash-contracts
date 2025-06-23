import { Deployer } from "@matterlabs/hardhat-zksync";
import { ethers } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contract, Provider } from "zksync-ethers";
import { HDNodeWallet } from "ethers";

interface Verify {
    address: string;
    constructorArguments: any[];
}

const toVerify: Verify[] = [];

export function getProvider(testnet: boolean): Provider {
    return new Provider(testnet ? "https://api.testnet.abs.xyz" : "https://api.mainnet.abs.xyz");
}

export function getWeth(testnet: boolean): string {
    const testnetWeth = "0x9EDCde0257F2386Ce177C3a7FCdd97787F0D841d";
    const mainnetWeth = "0x3439153EB7AF838Ad19d56E1571FBD09333C2809";

    return testnet ? testnetWeth : mainnetWeth;
}

export function getHashProducer(testnet: boolean): string {
    return testnet ? "0xc2bDed4B045bfdB5F051a13a55ed63FeEA45CB00" : "0x9b81Ec6F1Efa11d80835F2C1E8ae7fD46C522cdD";
}

export function getPlatformFeeCollector(testnet: boolean): string {
    return testnet ? "0x25bbEDE914021Fdb13B57d9866bB370965d015c1" : "0xc41Fbb7538dD5a74E76390d7878E3F6d245Bf5EA";
}

export function getHash(salt: string) {
    return ethers.keccak256(ethers.solidityPacked(["bytes32"], [salt]));
}

export function getSalt(mnemonic: string, tokenIndex: number, roundIndex: number): string {
    const path = `m/44'/60'/${tokenIndex}'/0/${roundIndex}`;

    const wallet = HDNodeWallet.fromPhrase(mnemonic, undefined, path);

    return wallet.privateKey;
}

export async function deploy(deployer: Deployer, contractName: string, args: any[] = []): Promise<Contract> {
    const Artifact = await deployer.loadArtifact(contractName);
    const contract = await deployer.deploy(Artifact, args);
    await contract.waitForDeployment();

    const address = await contract.getAddress();

    toVerify.push({
        address: address,
        constructorArguments: args,
    });

    console.log(`${Artifact.contractName} was deployed to ${address}`);

    return contract;
}

export async function tx(transaction: Promise<any>) {
    await (await transaction).wait();
}

export async function verifyAll(runtime: HardhatRuntimeEnvironment) {
    await sleep(90000);

    console.log(`Verifying contracts...`);
    for (const item of toVerify) {
        try {
            await verify(runtime, item.address, item.constructorArguments);
            console.log(`Verified ${item.address}`);
        } catch (error) {
            console.error(`Failed to verify ${item.address}:`, error);
        }
    }
}

async function verify(runtime: HardhatRuntimeEnvironment, address: string, args: any[]) {
    await sleep(1000);
    return runtime.run("verify:verify", {
        address,
        constructorArguments: args,
    });
}

function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
