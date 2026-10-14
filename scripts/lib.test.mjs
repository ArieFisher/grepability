// Unit tests for the helpers in helpers.mjs and lib.mjs. Run: node --test scripts/
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {blindSheetRows, changedOriginalLines, findScore, fisherExact, fromCsv, interleave, key, listedLines, matchesForms, median, option, percent, readWrongEdits, regressionCandidates, shellCommandNames, shuffle, splitKey, summarizeTranscript, toCsv, wilson} from './helpers.mjs';
import {commentLinesOfText, copyCodebase, diffSinceSnapshot, hiddenTestPath, isHiddenTest, loadTasks, makeRunCopy, proposedVersion, publishedVersion, versions, workDir} from './lib.mjs';

const commentLineNumbers = source => commentLinesOfText('source/x.ts', source).map(row => row.line);

test('commentLinesOfText finds a comment that follows a template string with a substitution', () => {
	const source = [
		'const a = `x ${b} y`; // real comment',
		'const c = 1;',
		'const d = `tail`;',
		'// second comment',
	].join('\n');
	assert.deepEqual(commentLineNumbers(source), [1, 4]);
});

test('commentLinesOfText skips comment-like text in a template tail', () => {
	const source = [
		'const a = `${b} // not a comment`;',
		'const c = 1;',
	].join('\n');
	assert.deepEqual(commentLineNumbers(source), []);
});

test('commentLinesOfText skips comment-like text in a regular expression literal', () => {
	const source = [
		'const pattern = /[/*]/;',
		'const next = 1;',
		'// real comment',
		'const end = /x*/;',
	].join('\n');
	assert.deepEqual(commentLineNumbers(source), [3]);
});

test('commentLinesOfText covers every line of a block comment and drops delimiter-only lines', () => {
	const source = [
		'/**',
		' * First words.',
		' * Second words.',
		' */',
		'export const a = 1; /* trailing */',
	].join('\n');
	assert.deepEqual(commentLineNumbers(source), [2, 3, 5]);
});

test('commentLinesOfText finds a comment before a closing bracket and in a JSDoc tag line', () => {
	const source = [
		'const a = {',
		'\tb: 1, // after the comma',
		'\t// before the bracket',
		'};',
		'/** @param x // still the same comment */ const z = 1;',
	].join('\n');
	assert.deepEqual(commentLineNumbers(source), [2, 3, 5]);
});

test('option reads the value after a flag and falls back when the flag is absent', () => {
	const argv = ['name', '--chunk', '60', '--model', 'sonnet'];
	assert.equal(option(argv, 'chunk', 120), '60');
	assert.equal(option(argv, 'model', 'opus'), 'sonnet');
	assert.equal(option(argv, 'parallel', 4), 4);
});

test('percent rounds a share to a whole percent and shows n/a for no value', () => {
	assert.equal(percent(0.125), '13%');
	assert.equal(percent(0.994), '99%');
	assert.equal(percent(1), '100%');
	assert.equal(percent(null), 'n/a');
});

test('splitKey inverts key', () => {
	assert.deepEqual(splitKey(key('source/core/client.ts', 419)), {file: 'source/core/client.ts', line: 419});
});

test('versions lists the published codebase first and the proposed codebase second', () => {
	assert.deepEqual(versions, [publishedVersion, proposedVersion]);
});

test('hiddenTestPath and isHiddenTest agree on the hidden test name', () => {
	const title = path.basename(hiddenTestPath('/copy'), '.test.ts');
	assert.ok(isHiddenTest(title), title);
	assert.ok(!isHiddenTest('retry.test'));
});

test('loadTasks reads the task configuration', () => {
	const config = loadTasks();
	assert.ok(config.tasks.length > 0);
	assert.equal(typeof config.agent.command, 'string');
	assert.equal(typeof config.agent.model, 'string');
});

test('copyCodebase copies files, leaves out node_modules and .git, and links the shared dependencies', () => {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-codebase-'));
	try {
		const source = path.join(scratch, 'source');
		fs.mkdirSync(path.join(source, 'src'), {recursive: true});
		fs.mkdirSync(path.join(source, 'node_modules', 'pkg'), {recursive: true});
		fs.mkdirSync(path.join(source, '.git'));
		fs.writeFileSync(path.join(source, 'src', 'a.ts'), 'export {};\n');
		const destination = path.join(scratch, 'out', 'copy');
		copyCodebase(source, destination);
		assert.equal(fs.readFileSync(path.join(destination, 'src', 'a.ts'), 'utf8'), 'export {};\n');
		assert.ok(!fs.existsSync(path.join(destination, '.git')));
		assert.ok(fs.lstatSync(path.join(destination, 'node_modules')).isSymbolicLink());
		assert.equal(fs.readlinkSync(path.join(destination, 'node_modules')), path.join(workDir, 'deps', 'node_modules'));
	} finally {
		fs.rmSync(scratch, {recursive: true, force: true});
	}
});

test('makeRunCopy copies a version, commits it as the snapshot, and leaves a clean tree', () => {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'make-run-copy-'));
	try {
		const source = path.join(scratch, 'source');
		fs.mkdirSync(path.join(source, 'src'), {recursive: true});
		fs.writeFileSync(path.join(source, 'src', 'a.ts'), 'export {};\n');
		fs.writeFileSync(path.join(source, '.gitignore'), 'node_modules/\n');
		const {directory, snapshot} = makeRunCopy(source, path.join(scratch, 'out', 'copy'));
		assert.match(snapshot, /^[\da-f]{40}$/);
		const git = (...args) => execFileSync('git', args, {cwd: directory, encoding: 'utf8'});
		assert.equal(git('rev-parse', 'HEAD').trim(), snapshot);
		assert.equal(git('status', '--porcelain'), '');
		assert.equal(diffSinceSnapshot(directory, snapshot), '');
	} finally {
		fs.rmSync(scratch, {recursive: true, force: true});
	}
});

test('listedLines reads single lines, ranges, and bare file names from the last fenced block', () => {
	const known = new Map([['source/core/client.ts', 1000], ['source/types/retry.ts', 100]]);
	const reply = [
		'Here is a draft:',
		'```',
		'source/core/client.ts:1',
		'```',
		'Final list:',
		'```text',
		'source/core/client.ts:440',
		'./source/core/client.ts:441-443',
		'types/retry.ts:18',
		'client.ts:500 – 501',
		'```',
	].join('\n');
	assert.deepEqual([...listedLines(reply, known)].sort(), [
		'source/core/client.ts:440',
		'source/core/client.ts:441',
		'source/core/client.ts:442',
		'source/core/client.ts:443',
		'source/core/client.ts:500',
		'source/core/client.ts:501',
		'source/types/retry.ts:18',
	]);
});

test('listedLines keeps an unknown or ambiguous file name as written', () => {
	const known = new Map([['source/a/index.ts', 50], ['source/b/index.ts', 50]]);
	assert.deepEqual([...listedLines('index.ts:3 and other.ts:4', known)].sort(), ['index.ts:3', 'other.ts:4']);
});

const listed = (text, lineCount = 20) => [...listedLines(text, new Map([['source/a.ts', lineCount]]))].sort();

test('listedLines does not let a range cross a line break', () => {
	assert.deepEqual(listed('source/a.ts:5\n- 10 more reasons'), ['source/a.ts:5']);
	assert.deepEqual(listed('source/a.ts:5\n10'), ['source/a.ts:5']);
});

test('listedLines clips a range to the length of the file', () => {
	assert.deepEqual(listed('source/a.ts:18-25'), ['source/a.ts:18', 'source/a.ts:19', 'source/a.ts:20']);
	assert.equal(listed('source/a.ts:1-3000000').length, 20);
	assert.deepEqual(listed('source/a.ts:30-40'), []);
});

test('listedLines ignores a descending range', () => {
	assert.deepEqual(listed('source/a.ts:9-3'), []);
});

test('listedLines reads a comma list as separate lines and ranges', () => {
	assert.deepEqual(listed('source/a.ts:5, 7, 9-10'), ['source/a.ts:10', 'source/a.ts:5', 'source/a.ts:7', 'source/a.ts:9']);
	assert.deepEqual([...listedLines('source/a.ts:5, source/b.ts:7')].sort(), ['source/a.ts:5', 'source/b.ts:7']);
});

test('listedLines keeps only the first line of a range in a file it has no length for', () => {
	assert.deepEqual([...listedLines('other.ts:4-6')], ['other.ts:4']);
});

test('changedOriginalLines maps hunks to old-side lines and ignores new files', () => {
	const diff = [
		'--- a/source/x.ts',
		'+++ b/source/x.ts',
		'@@ -10,2 +10,3 @@',
		'-old',
		'-old',
		'+new',
		'@@ -20 +21 @@',
		'-old',
		'+new',
		'@@ -30,0 +32,2 @@',
		'+inserted',
		'--- /dev/null',
		'+++ b/test/new.ts',
		'@@ -0,0 +1,5 @@',
		'+a',
	].join('\n');
	assert.deepEqual([...changedOriginalLines(diff)].sort(), ['source/x.ts:10', 'source/x.ts:11', 'source/x.ts:20']);
});

test('interleave puts one job from every cell in each round', () => {
	const jobs = [];
	for (const cell of ['a', 'b', 'c']) {
		for (let index = 0; index < 4; index++) {
			jobs.push({cell, index});
		}
	}

	const ordered = interleave(jobs, job => job.cell);
	assert.equal(ordered.length, 12);
	for (let round = 0; round < 4; round++) {
		const cells = ordered.slice(round * 3, (round * 3) + 3).map(job => job.cell).sort();
		assert.deepEqual(cells, ['a', 'b', 'c']);
	}
});

test('shuffle returns a permutation and leaves the input alone', () => {
	const input = [1, 2, 3, 4, 5];
	const output = shuffle(input);
	assert.deepEqual(input, [1, 2, 3, 4, 5]);
	assert.deepEqual([...output].sort(), input);
});

test('regressionCandidates lists a baseline-passing test that fails or is missing in the run', () => {
	const baseline = {'a › passes': true, 'a › fails': true, 'a › vanishes': true, 'a › was failing': false};
	const run = {'a › passes': true, 'a › fails': false, 'a › was failing': false};
	assert.deepEqual(regressionCandidates(baseline, run), ['a › fails', 'a › vanishes']);
});

test('regressionCandidates skips a failing test that the baseline lacks', () => {
	assert.deepEqual(regressionCandidates({'a › old': true}, {'a › old': true, 'a › new': false}), []);
});

test('blindSheetRows keeps the rows already on the sheet and appends only runs it lacks', () => {
	const existing = [{runId: 'r1', task: 't', diff: 'd1', final_reply: 'f1', wrong_edits: 'yes', notes: 'odd'}];
	const runs = [
		{runId: 'r1', task: 't', diff: 'd1', finalReply: 'f1'},
		{runId: 'r2', task: 't', diff: 'd2', finalReply: 'f2'},
	];
	assert.deepEqual(blindSheetRows(existing, runs), [
		['r1', 't', 'd1', 'f1', 'yes', 'odd'],
		['r2', 't', 'd2', 'f2', '', ''],
	]);
});

test('blindSheetRows throws on an existing row that lacks a column', () => {
	assert.throws(() => blindSheetRows([{runId: 'r1'}], []), /lacks the task column/);
});

test('readWrongEdits maps yes, no, and blank to true, false, and null', () => {
	const rows = [{runId: 'a', wrong_edits: 'Yes'}, {runId: 'b', wrong_edits: ' no '}, {runId: 'c', wrong_edits: ''}];
	assert.deepEqual([...readWrongEdits(rows, ['a', 'b', 'c'])], [['a', true], ['b', false], ['c', null]]);
});

test('readWrongEdits throws on another value, a repeated run, or a run missing from the sheet', () => {
	assert.throws(() => readWrongEdits([{runId: 'a', wrong_edits: 'maybe'}], ['a']), /maybe/);
	assert.throws(() => readWrongEdits([{runId: 'a', wrong_edits: ''}, {runId: 'a', wrong_edits: ''}], ['a']), /twice/);
	assert.throws(() => readWrongEdits([{runId: 'a', wrong_edits: ''}], ['a', 'b']), /b/);
});

test('median averages the two middle values of an even count and skips non-numbers', () => {
	assert.equal(median([4, 1, 3, 2]), 2.5);
	assert.equal(median([5, 1, 3]), 3);
	assert.equal(median([2, null, 'x', 8]), 5);
	assert.equal(median([]), null);
});

test('shellCommandNames lists the first word of every sub-command', () => {
	assert.deepEqual(shellCommandNames('rg foo src'), ['rg']);
	assert.deepEqual(shellCommandNames('cd src && rg foo | head -5'), ['cd', 'rg', 'head']);
	assert.deepEqual(shellCommandNames('ls; grep -r x . || echo none\nrg y'), ['ls', 'grep', 'echo', 'rg']);
});

test('shellCommandNames ignores operators inside quotes and leading variable assignments', () => {
	assert.deepEqual(shellCommandNames(String.raw`rg "a|b;c && d" src`), ['rg']);
	assert.deepEqual(shellCommandNames("grep 'x||y' f | wc -l"), ['grep', 'wc']);
	assert.deepEqual(shellCommandNames('LC_ALL=C rg foo'), ['rg']);
	assert.deepEqual(shellCommandNames('  '), []);
});

test('summarizeTranscript counts every sub-command of a compound shell command', () => {
	const event = {type: 'assistant', message: {content: [{type: 'tool_use', name: 'Bash', input: {command: 'cd src && rg foo | head'}}]}};
	assert.deepEqual(summarizeTranscript(JSON.stringify(event)).toolCounts, {'Bash:cd': 1, 'Bash:rg': 1, 'Bash:head': 1});
});

test('findScore reports the find rate, the lines missed, and success when none is missed', () => {
	const expected = new Set(['a:1', 'a:2', 'a:3', 'a:4']);
	assert.deepEqual(findScore(new Set(['a:1', 'a:2', 'a:9']), expected), {findRate: 0.5, missed: 2, success: false});
	assert.deepEqual(findScore(new Set(['a:1', 'a:2', 'a:3', 'a:4', 'a:9']), expected), {findRate: 1, missed: 0, success: true});
});

test('findScore throws when the ground truth lists no line for the concept', () => {
	assert.throws(() => findScore(new Set(['a:1']), new Set()), /no line/);
});

test('matchesForms tests the text of a line and never the text of a missing line', () => {
	const lines = ['const retry = 1;', 'other'];
	assert.equal(matchesForms(lines, 1, 'retry'), true);
	assert.equal(matchesForms(lines, 2, 'retry'), false);
	assert.equal(matchesForms(lines, 3, 'undefined'), false);
	assert.equal(matchesForms(lines, 0, 'undefined'), false);
});

test('diffSinceSnapshot writes a/ and b/ prefixes whatever the git configuration says', () => {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-since-snapshot-'));
	try {
		const git = (...args) => execFileSync('git', args, {cwd: scratch, encoding: 'utf8'});
		git('init', '-q');
		git('config', 'user.email', 'test@example.com');
		git('config', 'user.name', 'test');
		git('config', 'commit.gpgsign', 'false');
		git('config', 'core.hooksPath', os.devNull);
		fs.writeFileSync(path.join(scratch, 'f.txt'), 'one\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'start');
		const snapshot = git('rev-parse', 'HEAD').trim();
		fs.writeFileSync(path.join(scratch, 'f.txt'), 'two\n');
		git('config', 'diff.noprefix', 'true');
		const diff = diffSinceSnapshot(scratch, snapshot);
		assert.match(diff, /^--- a\/f\.txt$/m);
		assert.match(diff, /^\+\+\+ b\/f\.txt$/m);
		assert.deepEqual([...changedOriginalLines(diff)], ['f.txt:1']);
	} finally {
		fs.rmSync(scratch, {recursive: true, force: true});
	}
});

test('wilson brackets the observed share and clamps to [0, 1]', () => {
	const interval = wilson(9, 10);
	assert.ok(interval.low < 0.9 && interval.high > 0.9);
	assert.ok(interval.low > 0.5);
	assert.equal(wilson(10, 10).high, 1);
	assert.equal(wilson(0, 10).low, 0);
	assert.equal(wilson(0, 0), null);
});

test('fisherExact matches known values', () => {
	assert.ok(Math.abs(fisherExact(0, 10, 9, 1) - 0.000_119_08) < 1e-7);
	assert.ok(Math.abs(fisherExact(9, 1, 6, 4) - 0.303) < 0.002);
	assert.equal(fisherExact(5, 5, 5, 5), 1);
});

test('csv round-trips quoted fields', () => {
	const rows = [['a', 'b'], ['x,y', 'say "hi"\nthere']];
	const parsed = fromCsv(toCsv(rows));
	assert.deepEqual(parsed, [{a: 'x,y', b: 'say "hi"\nthere'}]);
});
