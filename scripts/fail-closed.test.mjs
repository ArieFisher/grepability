// Self-tests for the checks that make the scripts stop on bad input instead of recording a result.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {acceptTags, checkTaggers, integerOption, parseTap, readLockedLines, summarizeTranscript} from './helpers.mjs';
import {checkInstallCommand, compileCodebase, createService, installCodebase, loadCodebase, reexecuteVerification, runChecked} from './lib.mjs';

test('the codebase configuration holds a compile command', () => {
	const {compile} = loadCodebase();
	assert.ok(Array.isArray(compile) && compile.length > 0 && compile.every(part => typeof part === 'string'));
});

test('the codebase configuration holds an install command', () => {
	const {install} = loadCodebase();
	assert.ok(Array.isArray(install) && install.length > 0 && install.every(part => typeof part === 'string'));
});

test('checkInstallCommand accepts a command that skips install scripts and throws on one that runs them', () => {
	assert.doesNotThrow(() => checkInstallCommand(['npm', 'install', '--ignore-scripts']));
	assert.throws(() => checkInstallCommand(['npm', 'install']), /--ignore-scripts/);
	assert.throws(() => checkInstallCommand([]), /--ignore-scripts/);
});

test('installCodebase runs the install command in the directory it is given', () => {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'install-'));
	try {
		installCodebase(scratch, ['node', '-e', "require('node:fs').writeFileSync('installed.txt', 'yes')", '--', '--ignore-scripts']);
		assert.equal(fs.readFileSync(path.join(scratch, 'installed.txt'), 'utf8'), 'yes');
	} finally {
		fs.rmSync(scratch, {recursive: true, force: true});
	}
});

test('installCodebase throws when the command fails, cannot start, or lacks --ignore-scripts', () => {
	assert.throws(() => installCodebase(os.tmpdir(), ['node', '-e', 'process.exit(3)', '--', '--ignore-scripts']), /install command.*exited with status 3/s);
	assert.throws(() => installCodebase(os.tmpdir(), ['no-such-command-for-this-self-test', '--ignore-scripts']), /no-such-command-for-this-self-test/);
	assert.throws(() => installCodebase(os.tmpdir(), ['node', '-e', '0']), /--ignore-scripts/);
});

test('the codebase configuration skips install scripts', () => {
	assert.doesNotThrow(() => checkInstallCommand(loadCodebase().install));
});

test('compileCodebase runs the compile command in the directory it is given', () => {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-'));
	try {
		compileCodebase(scratch, ['node', '-e', "require('node:fs').writeFileSync('compiled.txt', 'yes')"]);
		assert.equal(fs.readFileSync(path.join(scratch, 'compiled.txt'), 'utf8'), 'yes');
	} finally {
		fs.rmSync(scratch, {recursive: true, force: true});
	}
});

test('compileCodebase throws when the compile command fails or cannot start', () => {
	assert.throws(() => compileCodebase(os.tmpdir(), ['node', '-e', 'process.exit(2)']), /compile command.*exited with status 2/s);
	assert.throws(() => compileCodebase(os.tmpdir(), ['no-such-command-for-this-self-test']), /no-such-command-for-this-self-test/);
});

test('integerOption returns a whole number at or above the minimum', () => {
	assert.equal(integerOption(['--agent-task-runs', '5'], 'agent-task-runs', 10, 1), 5);
	assert.equal(integerOption([], 'agent-task-runs', 10, 1), 10);
	assert.equal(integerOption(['--context', '0'], 'context', 3, 0), 0);
});

test('integerOption rejects text, fractions, and values below the minimum', () => {
	for (const value of ['abc', '2.5', '0', '-1', '']) {
		assert.throws(() => integerOption(['--chunk', value], 'chunk', 120, 1), /--chunk must be a whole number of at least 1/, value);
	}

	assert.throws(() => integerOption(['--chunk'], 'chunk', 120, 1), /--chunk/);
});

test('parseTap reads ok and not ok lines and skips SKIP and TODO lines', () => {
	const tap = [
		'TAP version 13',
		'ok 1 - a › passes',
		'not ok 2 - a › fails',
		'ok 3 - a › skipped # SKIP',
		'not ok 4 - a › todo # TODO later',
		'# tests 4',
	].join('\n');
	assert.deepEqual(parseTap(tap), {'a › passes': true, 'a › fails': false});
});

test('summarizeTranscript reads the final event even when the file has no trailing newline', () => {
	const events = [
		{type: 'assistant', message: {content: [{type: 'tool_use', name: 'Bash', input: {command: 'rg foo'}}, {type: 'tool_use', name: 'Read'}]}},
		{type: 'result', result: 'done', total_cost_usd: 0.5, num_turns: 3, duration_ms: 900, is_error: false},
	];
	const summary = summarizeTranscript(events.map(event => JSON.stringify(event)).join('\n'));
	assert.equal(summary.finalText, 'done');
	assert.equal(summary.isError, false);
	assert.deepEqual(summary.toolCounts, {'Bash:rg': 1, Read: 1});
});

test('summarizeTranscript marks a transcript with no result event as an error', () => {
	const summary = summarizeTranscript(JSON.stringify({type: 'assistant', message: {content: []}}));
	assert.equal(summary.isError, true);
	assert.equal(summary.finalText, '');
});

test('acceptTags keeps tags for items in the chunk and drops unknown concept ids', () => {
	const reply = '{"3": ["retry-count", "nonsense"], "4": []}';
	const tags = acceptTags(reply, new Set([3, 4, 5]), new Set(['retry-count', 'jitter']));
	assert.deepEqual([...tags], [[3, ['retry-count']], [4, []]]);
});

test('acceptTags rejects an item number outside the chunk and a tag list that is not an array', () => {
	const ids = new Set(['retry-count']);
	assert.throws(() => acceptTags('{"9": ["retry-count"]}', new Set([3]), ids), /item 9/i);
	assert.throws(() => acceptTags('{"3": "retry-count"}', new Set([3]), ids), /item 3/i);
	assert.throws(() => acceptTags('no object here', new Set([3]), ids), /No JSON object/);
});

const tagger = (name, rows) => ({name, tags: new Map(rows.map(([rowKey, ...ids]) => [rowKey, {ids: new Set(ids)}]))});

test('checkTaggers accepts two taggers that cover the sheet with known concept ids', () => {
	const sheet = ['a.ts:1', 'a.ts:2'];
	const taggers = [tagger('one', [['a.ts:1', 'retry-count'], ['a.ts:2']]), tagger('two', [['a.ts:1'], ['a.ts:2']])];
	assert.doesNotThrow(() => checkTaggers(sheet, taggers, new Set(['retry-count'])));
});

test('checkTaggers rejects one tagger, mismatched rows, and unknown concept ids', () => {
	const sheet = ['a.ts:1', 'a.ts:2'];
	const known = new Set(['retry-count']);
	const full = name => tagger(name, [['a.ts:1'], ['a.ts:2']]);
	assert.throws(() => checkTaggers(sheet, [full('one')], known), /at least two taggers/);
	assert.throws(() => checkTaggers(sheet, [full('one'), tagger('two', [['a.ts:1']])], known), /two.*a\.ts:2/s);
	assert.throws(() => checkTaggers(sheet, [full('one'), tagger('two', [['a.ts:1'], ['a.ts:2'], ['a.ts:3']])], known), /two.*a\.ts:3/s);
	assert.throws(() => checkTaggers(sheet, [full('one'), tagger('two', [['a.ts:1', 'retry-cuont'], ['a.ts:2']])], known), /retry-cuont/);
});

const lockedFile = new Map([[1, 'signal.addEventListener(\'abort\', onAbort);'], [2, 'const delay = 5;']]);
const readLockedFile = (file, line) => file === 'source/a.ts' ? lockedFile.get(line) : undefined;
const lockedEntry = {file: 'source/a.ts', line: 1, text: '\'abort\'', reason: 'event name the program compares at runtime'};

test('readLockedLines throws on a concept without a lockedLines array', () => {
	assert.throws(() => readLockedLines([{id: 'user-abort'}], readLockedFile), /user-abort.*lockedLines/);
	assert.throws(() => readLockedLines([{id: 'user-abort', lockedLine: []}], readLockedFile), /user-abort.*lockedLines/);
	assert.throws(() => readLockedLines([{id: 'user-abort', lockedLines: {}}], readLockedFile), /user-abort.*lockedLines/);
});

test('readLockedLines throws on an entry missing its file, line, text, or reason', () => {
	for (const field of ['file', 'line', 'text', 'reason']) {
		const entry = {...lockedEntry, [field]: undefined};
		assert.throws(() => readLockedLines([{id: 'user-abort', lockedLines: [entry]}], readLockedFile), new RegExp(`user-abort.*${field}`), field);
	}

	assert.throws(() => readLockedLines([{id: 'user-abort', lockedLines: [{...lockedEntry, line: 0}]}], readLockedFile), /user-abort.*line/);
	assert.throws(() => readLockedLines([{id: 'user-abort', lockedLines: [{...lockedEntry, reason: ''}]}], readLockedFile), /user-abort.*reason/);
});

test('readLockedLines throws on an entry whose text is not on its line', () => {
	const moved = {...lockedEntry, line: 2};
	assert.throws(() => readLockedLines([{id: 'user-abort', lockedLines: [moved]}], readLockedFile), /user-abort.*source\/a\.ts:2.*'abort'/s);
	const pastEnd = {...lockedEntry, line: 9};
	assert.throws(() => readLockedLines([{id: 'user-abort', lockedLines: [pastEnd]}], readLockedFile), /source\/a\.ts:9/);
	const otherFile = {...lockedEntry, file: 'source/b.ts'};
	assert.throws(() => readLockedLines([{id: 'user-abort', lockedLines: [otherFile]}], readLockedFile), /source\/b\.ts:1/);
});

test('runChecked returns the result of a command that ran, whatever its exit status', () => {
	const result = runChecked('node', ['-e', 'process.exit(3)']);
	assert.equal(result.status, 3);
});

test('runChecked throws when the command cannot start', () => {
	assert.throws(() => runChecked('no-such-command-for-this-self-test', []), /no-such-command-for-this-self-test/);
});

test('reexecuteVerification throws when the re-execution command cannot start', () => {
	const verificationSuite = {directory: 'test', extension: '.ts', verificationTitleSeparator: ' › ', reexecution: ['no-such-command-for-this-self-test', '{file}', '{name}']};
	assert.throws(() => reexecuteVerification(os.tmpdir(), 'a › b', 1, verificationSuite), /no-such-command-for-this-self-test/);
});

// A re-execution command that prints fixed TAP lines, as a runner prints them when it executes one verification file,
// with no file in the titles. The runner matches names in any letter case, so one re-execution can execute two
// individual codebase verifications.
const fixedTapReexecution = (lines, status) => ({
	directory: 'test',
	extension: '.ts',
	verificationTitleSeparator: ' › ',
	reexecution: ['node', '-e', `console.log(${JSON.stringify(lines.join('\n'))}); process.exit(${status})`, '{file}', '{name}'],
});

test('reexecuteVerification counts a pass for an individual codebase verification that passes when one whose name differs only in letter case fails', () => {
	const verificationSuite = fixedTapReexecution(['ok 1 - Retry works', 'not ok 2 - retry works'], 1);
	assert.equal(reexecuteVerification(os.tmpdir(), 'a › Retry works', 2, verificationSuite), 2);
	assert.equal(reexecuteVerification(os.tmpdir(), 'a › retry works', 2, verificationSuite), 0);
});

test('reexecuteVerification counts no pass for a missing individual codebase verification when one whose name differs only in letter case passes', () => {
	const verificationSuite = fixedTapReexecution(['ok 1 - Retry works'], 0);
	assert.equal(reexecuteVerification(os.tmpdir(), 'a › retry works', 2, verificationSuite), 0);
});

test('reexecuteVerification reads a name holding a * as printed, and counts no pass for a skipped individual codebase verification', () => {
	assert.equal(reexecuteVerification(os.tmpdir(), 'a › x * y', 1, fixedTapReexecution(['ok 1 - x * y'], 0)), 1);
	assert.equal(reexecuteVerification(os.tmpdir(), 'a › x', 1, fixedTapReexecution(['ok 1 - x # SKIP'], 0)), 0);
});

test('createService throws when the tsconfig is missing or invalid', () => {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'service-'));
	try {
		assert.throws(() => createService(scratch), /tsconfig/);
		fs.writeFileSync(path.join(scratch, 'tsconfig.json'), '{"compilerOptions": {"target": "nonsense"}}');
		assert.throws(() => createService(scratch), /tsconfig/);
	} finally {
		fs.rmSync(scratch, {recursive: true, force: true});
	}
});
