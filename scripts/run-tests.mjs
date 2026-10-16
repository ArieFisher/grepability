// Runs the codebase's type checks and tests in one version or run copy and records pass/fail per test.
// The commands come from config/codebase.json; the test command must print TAP.
// The result file is written once the commands have run. A command that cannot start, or a test run
// that prints no TAP result, stops the script with no result file. A failed type check still writes
// the file, because the agent score reads it, and sets the exit status to 1.
// Usage: node run-tests.mjs <version | directory> [output.json]
import fs from 'node:fs';
import path from 'node:path';
import {loadCodebase, parseTap, runChecked, versionDir, versions, workDir, writeJson} from './lib.mjs';

const [target, outputArgument] = process.argv.slice(2);
if (!target) {
	throw new Error('Usage: node run-tests.mjs <version | directory> [output.json]');
}

const root = versions.includes(target) ? versionDir(target) : path.resolve(target);
const output = outputArgument ? path.resolve(outputArgument) : path.join(workDir, `tests-${path.basename(root)}.json`);
const codebase = loadCodebase();

const run = ([command, ...args]) => {
	const result = runChecked(command, args, {cwd: root});
	return {ok: result.status === 0, output: result.stdout + result.stderr};
};

const typechecks = codebase.typecheck.map(command => run(command));
const typecheck = {ok: typechecks.every(check => check.ok), output: typechecks.map(check => check.output).join('')};
const testFiles = fs.readdirSync(path.join(root, codebase.verificationSuite.directory))
	.filter(file => file.endsWith(codebase.verificationSuite.extension) && !codebase.verificationSuite.skip.includes(file))
	.map(file => `${codebase.verificationSuite.directory}/${file}`);
const tap = run([...codebase.verificationSuite.command, ...testFiles]);

const tests = parseTap(tap.output);
if (Object.keys(tests).length === 0) {
	throw new Error(`The test command printed no TAP results in ${root}. Output starts: ${tap.output.slice(0, 500)}`);
}

const passed = Object.values(tests).filter(Boolean).length;
const result = {
	directory: root,
	typecheck: typecheck.ok,
	typecheckErrors: typecheck.ok ? '' : typecheck.output.slice(0, 4000),
	passed,
	failed: Object.keys(tests).length - passed,
	tests,
};
writeJson(output, result);
console.log(`${path.basename(root)}: typecheck ${typecheck.ok ? 'ok' : 'FAILED'}, ${passed} passed, ${result.failed} failed -> ${output}`);
if (!typecheck.ok) {
	process.exitCode = 1;
}
