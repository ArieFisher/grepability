// Runs the codebase's compile step in one version (command from config/codebase.json).
// setup.sh calls it for the published codebase; build-proposed.mjs calls it for the proposed codebase.
// Usage: node compile-codebase.mjs <version>
import {compileCodebase, versionDir, versions} from './lib.mjs';

const [version] = process.argv.slice(2);
if (!versions.includes(version)) {
	throw new Error(`Usage: node compile-codebase.mjs <${versions.join(' | ')}>`);
}

compileCodebase(versionDir(version));
console.log(`Compiled ${version}.`);
