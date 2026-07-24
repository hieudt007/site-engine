import { rebuildThemeAssets } from './src/services/themeAssetBundler.ts'; 
async function run() { 
  await rebuildThemeAssets('default'); 
  await rebuildThemeAssets('minimal'); 
  console.log('Rebuilt successfully'); 
} 
run();
