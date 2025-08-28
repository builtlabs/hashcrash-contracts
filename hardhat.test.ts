import { HardhatUserConfig, vars } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";

const COINMARKETCAP_API_KEY = vars.get("COINMARKETCAP_API_KEY");

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  // No zksolc here
  defaultNetwork: "hardhat",
  gasReporter: {
    coinmarketcap: `${COINMARKETCAP_API_KEY}`,
    gasPriceApi: `https://api.etherscan.io/api?module=proxy&action=eth_gasPrice`,
    enabled: true,
    currency: "USD",
  },
  networks: {
    hardhat: {
      chainId: 31337,
      accounts: { count: 100 },
    },
  },
  mocha: { timeout: 1_200_000 },
};

export default config;
