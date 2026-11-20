// Pebble packages a single JS entrypoint; inline the tested core helpers.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const core = readFileSync('src/plugin/core.js','utf8');
const runtime = readFileSync('src/plugin/index.js','utf8');
if (!runtime.includes('/* __ASANA_CORE__ */')) throw Error('Missing inline marker');
const result = runtime.replace('/* __ASANA_CORE__ */', core);
mkdirSync('build-src',{recursive:true});
writeFileSync('build-src/plugin.js',result);
console.log('Generated build-src/plugin.js. Set pebble.plugin.script to build-src/plugin.js for packaging.');
