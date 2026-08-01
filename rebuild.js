import { rebuildThemeAssets } from "./src/services/themeAssetBundler.js";

async function run() {
  await rebuildThemeAssets("default");
  console.log("Assets rebuilt.");
}

run().catch(console.error);
