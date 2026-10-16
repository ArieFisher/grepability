// Executes the codebase's type checks and codebase verification suite in one codebase version or agent task run
// copy and records pass or fail per individual codebase verification. The commands come from
// config/codebase.json; the suite command must print TAP.
// The result file is written once the commands have finished. A command that cannot start, or a codebase
// verification suite execution that prints no TAP result, stops the script with no result file. A failed type
// check still writes the file, because the agent score reads it, and sets the exit status to 1.
// Usage: node execute-verification-suite.mjs <codebase version | directory> [output.json]
import fs from 'node:fs';
import path from 'node:path';
import {codebaseVersionDir, codebaseVersions, loadCodebase, parseTap, runChecked, workDir, writeJson} from './lib.mjs';

const [target, outputArgument] = process.argv.slice(2);
if (!target) {
	throw new Error('Usage: node execute-verification-suite.mjs <codebase version | directory> [output.json]');
}

const root = codebaseVersions.includes(target) ? codebaseVersionDir(target) : path.resolve(target);
const output = outputArgument ? path.resolve(outputArgument) : path.join(workDir, `tests-${path.basename(root)}.json`);
const codebase = loadCodebase();

const executeCommand = ([command, ...args]) => {
	const result = runChecked(command, args, {cwd: root});
	return {ok: result.status === 0, output: result.stdout + result.stderr};
};

const typechecks = codebase.typecheck.map(command => executeCommand(command));
const typecheck = {ok: typechecks.every(check => check.ok), output: typechecks.map(check => check.output).join('')};
const {verificationSuite} = codebase;
const verificationFiles = fs.readdirSync(path.join(root, verificationSuite.directory))
	.filter(file => file.endsWith(verificationSuite.extension) && !verificationSuite.skip.includes(file))
	.map(file => `${verificationSuite.directory}/${file}`);
const tap = executeCommand([...verificationSuite.command, ...verificationFiles]);

const verifications = parseTap(tap.output);
if (Object.keys(verifications).length === 0) {
	throw new Error(`The codebase verification suite command printed no TAP results in ${root}. Output starts: ${tap.output.slice(0, 500)}`);
}

const passed = Object.values(verifications).filter(Boolean).length;
const result = {
	directory: root,
	typecheck: typecheck.ok,
	typecheckErrors: typecheck.ok ? '' : typecheck.output.slice(0, 4000),
	passed,
	failed: Object.keys(verifications).length - passed,
	tests: verifications,
};
writeJson(output, result);
console.log(`${path.basename(root)}: typecheck ${typecheck.ok ? 'ok' : 'FAILED'}, ${passed} passed, ${result.failed} failed -> ${output}`);
if (!typecheck.ok) {
	process.exitCode = 1;
}
