// Runs the codebase's type checks and tests in one copy of the code and records pass/fail per test.
// The commands come from config/codebase.json; the test command must print TAP.
// Usage: node run-tests.mjs <version | directory> [output.json]
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {loadCodebase, maxOutputBytes, versionDir, versions, workDir, writeJson} from './lib.mjs';

const [target, outputArgument] = process.argv.slice(2);
const root = versions.includes(target) ? versionDir(target) : path.resolve(target);
const output = outputArgument ? path.resolve(outputArgument) : path.join(workDir, `tests-${path.basename(root)}.json`);
const codebase = loadCodebase();

const run = ([command, ...args]) => {
	const result = spawnSync(command, args, {cwd: root, encoding: 'utf8', maxBuffer: maxOutputBytes});
	return {ok: result.status === 0, output: (result.stdout ?? '') + (result.stderr ?? '')};
};

const typechecks = codebase.typecheck.map(command => run(command));
const typecheck = {ok: typechecks.every(check => check.ok), output: typechecks.map(check => check.output).join('')};
const testFiles = fs.readdirSync(path.join(root, codebase.tests.directory))
	.filter(file => file.endsWith(codebase.tests.extension) && !codebase.tests.skip.includes(file))
	.map(file => `${codebase.tests.directory}/${file}`);
const tap = run([...codebase.tests.command, ...testFiles]);

const tests = {};
for (const line of tap.output.split('\n')) {
	const match = /^(not ok|ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/.exec(line);
	if (match && !match[3]) {
		tests[match[2]] = match[1] === 'ok';
	}
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
