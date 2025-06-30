import { HardhatUserConfig, vars } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-ethers";
import "@matterlabs/hardhat-zksync";

const COINMARKETCAP_API_KEY = vars.get("COINMARKETCAP_API_KEY");
const ABSSCAN_API_KEY = vars.get("ABSSCAN_API_KEY");

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
        version: "1.5.12",
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
    defaultNetwork: "hardhat",
    gasReporter: {
        coinmarketcap: `${COINMARKETCAP_API_KEY}`,
        gasPriceApi: `https://api.basescan.org/api?module=proxy&action=eth_gasPrice`,
        enabled: true,
        currency: "USD",
    },
    networks: {
        hardhat: {
            accounts: {
                count: 100,
            },
        },
        abstractTestnet: {
            url: "https://api.testnet.abs.xyz",
            ethNetwork: "sepolia",
            zksync: true,
            chainId: 11124,
        },
        abstractMainnet: {
            url: "https://api.mainnet.abs.xyz",
            ethNetwork: "mainnet",
            zksync: true,
            chainId: 2741,
        },
    },
    etherscan: {
        apiKey: {
            abstractTestnet: "TACK2D1RGYX9U7MC31SZWWQ7FCWRYQ96AD",
            abstractMainnet: ABSSCAN_API_KEY,
        },
        customChains: [
            {
                network: "abstractTestnet",
                chainId: 11124,
                urls: {
                    apiURL: "https://api-sepolia.abscan.org/api",
                    browserURL: "https://sepolia.abscan.org/",
                },
            },
            {
                network: "abstractMainnet",
                chainId: 2741,
                urls: {
                    apiURL: "https://api.abscan.org/api",
                    browserURL: "https://abscan.org/",
                },
            },
        ],
    },
    mocha: {
        timeout: 1200000, // 20 minutes
    },
};

export default config;
