// Installs the codebase's dependencies in one directory (command from config/codebase.json).
// setup.sh calls it for the published codebase. The command runs as an argument list, with no shell.
// Usage: node install-codebase.mjs <directory>
import {installCodebase} from './lib.mjs';

const [directory] = process.argv.slice(2);
if (!directory) {
	throw new Error('Usage: node install-codebase.mjs <directory>');
}

installCodebase(directory);
console.log(`Installed dependencies in ${directory}.`);
