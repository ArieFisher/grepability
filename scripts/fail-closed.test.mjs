// Unit tests for the checks that make the scripts stop on bad input instead of recording a result.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {acceptTags, checkReviewers, integerOption, parseTap, summarizeTranscript} from './helpers.mjs';
import {checkInstallCommand, compileCodebase, createService, installCodebase, loadCodebase, rerunTest, runChecked} from './lib.mjs';

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
	assert.throws(() => installCodebase(os.tmpdir(), ['no-such-command-for-this-test', '--ignore-scripts']), /no-such-command-for-this-test/);
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
	assert.throws(() => compileCodebase(os.tmpdir(), ['no-such-command-for-this-test']), /no-such-command-for-this-test/);
});

test('integerOption returns a whole number at or above the minimum', () => {
	assert.equal(integerOption(['--runs', '5'], 'runs', 10, 1), 5);
	assert.equal(integerOption([], 'runs', 10, 1), 10);
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

const reviewer = (name, rows) => ({name, tags: new Map(rows.map(([rowKey, ...ids]) => [rowKey, {ids: new Set(ids)}]))});

test('checkReviewers accepts two reviewers that cover the sheet with known concept ids', () => {
	const sheet = ['a.ts:1', 'a.ts:2'];
	const reviewers = [reviewer('one', [['a.ts:1', 'retry-count'], ['a.ts:2']]), reviewer('two', [['a.ts:1'], ['a.ts:2']])];
	assert.doesNotThrow(() => checkReviewers(sheet, reviewers, new Set(['retry-count'])));
});

test('checkReviewers rejects one reviewer, mismatched rows, and unknown concept ids', () => {
	const sheet = ['a.ts:1', 'a.ts:2'];
	const known = new Set(['retry-count']);
	const full = name => reviewer(name, [['a.ts:1'], ['a.ts:2']]);
	assert.throws(() => checkReviewers(sheet, [full('one')], known), /at least two reviewers/);
	assert.throws(() => checkReviewers(sheet, [full('one'), reviewer('two', [['a.ts:1']])], known), /two.*a\.ts:2/s);
	assert.throws(() => checkReviewers(sheet, [full('one'), reviewer('two', [['a.ts:1'], ['a.ts:2'], ['a.ts:3']])], known), /two.*a\.ts:3/s);
	assert.throws(() => checkReviewers(sheet, [full('one'), reviewer('two', [['a.ts:1', 'retry-cuont'], ['a.ts:2']])], known), /retry-cuont/);
});

test('runChecked returns the result of a command that ran, whatever its exit status', () => {
	const result = runChecked('node', ['-e', 'process.exit(3)']);
	assert.equal(result.status, 3);
});

test('runChecked throws when the command cannot start', () => {
	assert.throws(() => runChecked('no-such-command-for-this-test', []), /no-such-command-for-this-test/);
});

test('rerunTest throws when the rerun command cannot start', () => {
	const tests = {directory: 'test', extension: '.ts', titleSeparator: ' › ', rerun: ['no-such-command-for-this-test', '{file}', '{name}']};
	assert.throws(() => rerunTest(os.tmpdir(), 'a › b', 1, tests), /no-such-command-for-this-test/);
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
