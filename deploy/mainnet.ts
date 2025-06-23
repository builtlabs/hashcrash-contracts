import { HardhatRuntimeEnvironment } from "hardhat/types";
import Anon from "./anon";
import Public from "./public";

export default async function (runtime: HardhatRuntimeEnvironment) {
    await Anon(runtime);
    await Public(runtime);
}
