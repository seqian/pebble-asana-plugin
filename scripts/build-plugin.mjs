// Rebuild the single-file Pebble plugin from source.
import { readFileSync, writeFileSync } from 'node:fs';
const core = readFileSync('src/plugin/core.js', 'utf8');
const template = readFileSync('src/plugin/template.js', 'utf8');
if (!template.includes('/* __ASANA_CORE__ */')) throw Error('Missing core marker');
writeFileSync('src/plugin/index.js', template.replace('/* __ASANA_CORE__ */', core));
console.log('Updated src/plugin/index.js');
