// Runs the codebase's compile step in one codebase version (command from config/codebase.json).
// setup.sh calls it for the published codebase; build-proposed.mjs calls it for the proposed codebase.
// Usage: node compile-codebase.mjs <codebase version>
import {codebaseVersionDir, codebaseVersions, compileCodebase} from './lib.mjs';

const [codebaseVersion] = process.argv.slice(2);
if (!codebaseVersions.includes(codebaseVersion)) {
	throw new Error(`Usage: node compile-codebase.mjs <${codebaseVersions.join(' | ')}>`);
}

compileCodebase(codebaseVersionDir(codebaseVersion));
console.log(`Compiled ${codebaseVersion}.`);
