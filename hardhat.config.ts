import { HardhatUserConfig, vars } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-ethers";
import "@matterlabs/hardhat-zksync";

const ETHERSCAN_API_KEY = vars.get("ETHERSCAN_API_KEY");
const ALCHEMY_API_KEY = vars.get("ALCHEMY_API_KEY");

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.24",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    zksolc: {
        version: "1.5.13",
        compilerSource: "binary",
        settings: {
            enableEraVMExtensions: true,
            codegen: "yul",
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    networks: {
        abstractTestnet: {
            url: `https://abstract-testnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
            ethNetwork: "sepolia",
            zksync: true,
            chainId: 11124,
        },
        abstractMainnet: {
            url: `https://abstract-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
            ethNetwork: "mainnet",
            zksync: true,
            chainId: 2741,
        },
    },
    etherscan: {
        apiKey: ETHERSCAN_API_KEY,
        customChains: [
            {
                network: "abstractTestnet",
                chainId: 11124,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api",
                    browserURL: "https://sepolia.abscan.org/",
                },
            },
            {
                network: "abstractMainnet",
                chainId: 2741,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api",
                    browserURL: "https://abscan.org/",
                },
            },
        ],
    },
};

export default config;
