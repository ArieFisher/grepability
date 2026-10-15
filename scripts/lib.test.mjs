// Unit tests for the helpers in helpers.mjs and lib.mjs. Run: node --test scripts/
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {blindSheetRows, changedOriginalLines, findScore, fisherExact, fromCsv, interleave, key, listedLines, matchesForms, mean, median, missingRuns, option, percent, readAdjudication, judgeLostTitles, lostRerunLimit, readWrongEdits, regressionCandidates, renamedTitles, runMeasures, shellCommandNames, shuffle, splitKey, successScore, summarizeTranscript, toCsv, truthStatement, usedAdjudicators, wilson} from './helpers.mjs';
import {commentLinesOfText, copyCodebase, diffSinceSnapshot, hiddenTestPath, isHiddenTest, loadCodebase, loadTasks, makeRunCopy, proposedVersion, publishedVersion, versions, workDir} from './lib.mjs';

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

test('runMeasures reads time, cost, turns, and tool counts of a local run', () => {
	const run = {wallMs: 90_400, costUsd: 0.5, turns: 7, toolCounts: {Read: 3, Grep: 2, 'Bash:rg': 1, 'Bash:cat': 4}};
	assert.deepEqual(runMeasures(run), {wallSeconds: 90, costUsd: 0.5, turns: 7, searchCalls: 3, readCalls: 3, tools: JSON.stringify(run.toolCounts)});
});

test('runMeasures gives null for what a cloud run does not report', () => {
	const run = {wallMs: null, costUsd: null, turns: null, toolCounts: null};
	assert.deepEqual(runMeasures(run), {wallSeconds: null, costUsd: null, turns: null, searchCalls: null, readCalls: null, tools: ''});
});

test('missingRuns lists the runs each cell still needs, numbered after the runs done', () => {
	const tasks = [{id: 't1'}, {id: 't2'}];
	const done = (task, version) => task.id === 't1' && version === 'a' ? 2 : 0;
	const jobs = missingRuns(tasks, ['a', 'b'], 3, done);
	assert.equal(jobs.length, (3 - 2) + 3 + 3 + 3);
	assert.deepEqual(jobs.filter(job => job.task.id === 't1' && job.version === 'a').map(job => job.index), [2]);
	assert.deepEqual(jobs.filter(job => job.task.id === 't2' && job.version === 'b').map(job => job.index), [0, 1, 2]);
});

test('shuffle returns a permutation and leaves the input alone', () => {
	const input = [1, 2, 3, 4, 5];
	const output = shuffle(input);
	assert.deepEqual(input, [1, 2, 3, 4, 5]);
	assert.deepEqual([...output].sort(), input);
});

const testsConfig = loadCodebase().tests;
// One file of a diff with zero context lines: a single hunk holding the given removed and added lines.
const hunk = (file, lines) => {
	const count = sign => lines.filter(line => line.startsWith(sign)).length;
	return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, `@@ -1,${count('-')} +1,${count('+')} @@`, ...lines].join('\n');
};

test('renamedTitles maps the new title of a renamed declaration to its old title', () => {
	const diff = hunk('test/retry.ts', ["-test('retryCount is 1', async t => {", "+test('retryNumber is 1', async t => {"]);
	assert.deepEqual(renamedTitles(diff, testsConfig), new Map([['retry › retryNumber is 1', 'retry › retryCount is 1']]));
});

test('renamedTitles pairs removed and added declarations in order within one hunk', () => {
	const diff = hunk('test/hooks.ts', [
		"-test('a retryCount', async t => {",
		'-	const retryCount = 1;',
		"-test.serial(\"b retryCount\", t => {",
		"+test('a retryNumber', async t => {",
		'+	const retryNumber = 1;',
		"+test.serial(\"b retryNumber\", t => {",
	]);
	assert.deepEqual(renamedTitles(diff, testsConfig), new Map([['hooks › a retryNumber', 'hooks › a retryCount'], ['hooks › b retryNumber', 'hooks › b retryCount']]));
});

test('renamedTitles skips a hunk whose removed and added declaration counts differ', () => {
	const diff = hunk('test/retry.ts', ["-test('gone', t => {", "-test('also gone', t => {", "+test('added', t => {"]);
	assert.deepEqual(renamedTitles(diff, testsConfig), new Map());
});

test('renamedTitles pairs declarations only within the same hunk', () => {
	const diff = [hunk('test/retry.ts', ["-test('gone', t => {"]), '@@ -20,0 +20,1 @@', "+test('added', t => {"].join('\n');
	assert.deepEqual(renamedTitles(diff, testsConfig), new Map());
});

test('renamedTitles ignores files outside the test directory, with another extension, or skipped', () => {
	const lines = ["-test('old', t => {", "+test('new', t => {"];
	const diff = [hunk('source/retry.ts', lines), hunk('test/retry.js', lines), hunk('test/browser.ts', lines)].join('\n');
	assert.deepEqual(renamedTitles(diff, testsConfig), new Map());
});

test('renamedTitles reads backtick and escaped titles and skips a title with a template expression', () => {
	const diff = hunk('test/retry.ts', [
		"-test(`plain retryCount`, t => {",
		"-test('don\\'t retryCount', t => {",
		'-	test(`${name} retryCount`, t => {',
		"+test(`plain retryNumber`, t => {",
		"+test('don\\'t retryNumber', t => {",
		'+	test(`${name} retryNumber`, t => {',
	]);
	assert.deepEqual(renamedTitles(diff, testsConfig), new Map([['retry › plain retryNumber', 'retry › plain retryCount'], ["retry › don't retryNumber", "retry › don't retryCount"]]));
});

test('renamedTitles reads a removed line that starts with dashes as a removed line, not a file header', () => {
	const diff = hunk('test/retry.ts', ['--- a/test/other.ts', "-test('old', t => {", "+test('new', t => {"]);
	assert.deepEqual(renamedTitles(diff, testsConfig), new Map([['retry › new', 'retry › old']]));
});

test('renamedTitles maps nothing when a declaration keeps its title', () => {
	const diff = hunk('test/retry.ts', ["-test('same', async t => {", "+test('same', t => {"]);
	assert.deepEqual(renamedTitles(diff, testsConfig), new Map());
});

test('renamedTitles reads the whole hunk when it holds no-newline markers', () => {
	const marker = '\\ No newline at end of file';
	const diff = hunk('test/retry.ts', ["-test('a', t => {", "-test('b', t => {", marker, "+test('c', t => {", "+test('d', t => {", marker]);
	assert.deepEqual(renamedTitles(diff, testsConfig), new Map([['retry › c', 'retry › a'], ['retry › d', 'retry › b']]));
});

test('renamedTitles uses the old path for removed declarations and the new path for added ones', () => {
	const diff = ['diff --git a/test/old.ts b/test/new.ts', 'similarity index 90%', 'rename from test/old.ts', 'rename to test/new.ts', '--- a/test/old.ts', '+++ b/test/new.ts', '@@ -1 +1 @@', "-test('x', t => {", "+test('y', t => {"].join('\n');
	assert.deepEqual(renamedTitles(diff, testsConfig), new Map([['new › y', 'old › x']]));
});

test('renamedTitles pairs nothing in a new or a deleted test file', () => {
	const diff = [
		'diff --git a/test/added.ts b/test/added.ts', 'new file mode 100644', '--- /dev/null', '+++ b/test/added.ts', '@@ -0,0 +1 @@', "+test('x', t => {",
		'diff --git a/test/gone.ts b/test/gone.ts', 'deleted file mode 100644', '--- a/test/gone.ts', '+++ /dev/null', '@@ -1 +0,0 @@', "-test('y', t => {",
	].join('\n');
	assert.deepEqual(renamedTitles(diff, testsConfig), new Map());
});

test('renamedTitles reads a path that git ends with a tab', () => {
	const diff = ['diff --git a/test/my file.ts b/test/my file.ts', '--- a/test/my file.ts\t', '+++ b/test/my file.ts\t', '@@ -1 +1 @@', "-test('x', t => {", "+test('y', t => {"].join('\n');
	assert.deepEqual(renamedTitles(diff, testsConfig), new Map([['my file › y', 'my file › x']]));
});

test('renamedTitles throws on a file header it cannot read, such as a quoted path', () => {
	const diff = [hunk('test/a.ts', ["-test('p', t => {", "+test('q', t => {"]), 'diff --git "a/test/\\303\\251.ts" "b/test/\\303\\251.ts"', '--- "a/test/\\303\\251.ts"', '+++ "b/test/\\303\\251.ts"', '@@ -1 +1 @@', "-test('r', t => {", "+test('s', t => {"].join('\n');
	assert.throws(() => renamedTitles(diff, testsConfig), /cannot read the file header/);
});

test('renamedTitles skips a title with an escape other than a quote or a backslash', () => {
	const diff = hunk('test/retry.ts', ["-test('line\\nbreak', t => {", "+test('line\\nbreaks', t => {"]);
	assert.deepEqual(renamedTitles(diff, testsConfig), new Map());
});

test('regressionCandidates reruns a baseline-passing test that fails and lists the lost titles of its test file', () => {
	const baseline = {'a › passes': true, 'a › fails': true, 'a › vanishes': true, 'a › was failing': false};
	const run = {'a › passes': true, 'a › fails': false, 'a › was failing': false};
	assert.deepEqual(regressionCandidates(baseline, run, new Map(), ' › '), {rerun: ['a › fails'], files: [{file: 'a', lostTitles: ['a › vanishes']}]});
});

test('regressionCandidates skips a failing test that the baseline lacks', () => {
	assert.deepEqual(regressionCandidates({'a › old': true}, {'a › old': true, 'a › new': false}, new Map(), ' › '), {rerun: [], files: []});
});

test('regressionCandidates judges a renamed test by its result under the new title', () => {
	const renames = new Map([['a › retryNumber is 1', 'a › retryCount is 1']]);
	const baseline = {'a › retryCount is 1': true, 'a › other': true};
	assert.deepEqual(regressionCandidates(baseline, {'a › retryNumber is 1': false, 'a › other': true}, renames, ' › '), {rerun: ['a › retryNumber is 1'], files: []});
	assert.deepEqual(regressionCandidates(baseline, {'a › retryNumber is 1': true, 'a › other': true}, renames, ' › '), {rerun: [], files: []});
});

test('regressionCandidates ignores a renamed test that failed in the baseline and still fails', () => {
	assert.deepEqual(regressionCandidates({'a › was failing': false}, {'a › renamed': false}, new Map([['a › renamed', 'a › was failing']]), ' › '), {rerun: [], files: []});
});

test('regressionCandidates lists the lost title of a renamed test under its new title', () => {
	assert.deepEqual(regressionCandidates({'a › old': true}, {}, new Map([['a › new', 'a › old']]), ' › '), {rerun: [], files: [{file: 'a', lostTitles: ['a › new']}]});
});

test('regressionCandidates counts a new title with no rename as a lost title plus a new test', () => {
	assert.deepEqual(regressionCandidates({'a › old': true}, {'a › new': true}, new Map(), ' › '), {rerun: [], files: [{file: 'a', lostTitles: ['a › old']}]});
});

test('regressionCandidates groups by the text before the first separator and handles a title named __proto__', () => {
	const baseline = {'a › b › c': true, 'a › __proto__': true};
	assert.deepEqual(regressionCandidates(baseline, {}, new Map(), ' › '), {rerun: [], files: [{file: 'a', lostTitles: ['a › b › c', 'a › __proto__']}]});
});

test('judgeLostTitles marks a test file that stopped partway and counts the failed reruns before the pass as removed', () => {
	const results = [false, false, true];
	assert.deepEqual(judgeLostTitles(['a › gone', 'a › gone too', 'a › present', 'a › other'], () => results.shift()), {removed: 2, stoppedPartway: true});
});

test('judgeLostTitles counts every lost title as removed when all reruns fail', () => {
	assert.deepEqual(judgeLostTitles(['a › x', 'a › y', 'a › z'], () => false), {removed: 3, stoppedPartway: false});
});

test('judgeLostTitles stops after the lost rerun limit of failed reruns', () => {
	const lost = Array.from({length: 100}, (_, i) => `a › t${i}`);
	let reruns = 0;
	assert.deepEqual(judgeLostTitles(lost, () => {
		reruns++;
		return false;
	}), {removed: 100, stoppedPartway: false});
	assert.equal(reruns, lostRerunLimit);
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

test('mean averages the numbers in a list, skips other values, and gives null for none', () => {
	assert.equal(mean([1, 2, null, 'x', 6]), 3);
	assert.equal(mean([null]), null);
	assert.equal(mean([]), null);
});

test('successScore counts successes over runs with the Wilson interval, and gives null for no runs', () => {
	const score = successScore([{success: true}, {success: false}, {success: true}, {success: true}]);
	assert.equal(score.successes, 3);
	assert.equal(score.runs, 4);
	assert.equal(score.score, 0.75);
	assert.deepEqual(score.interval, wilson(3, 4));
	assert.equal(successScore([]), null);
});

const adjudicationRows = [
	{file: 'source/a.ts', line: '3', concept: 'count', decision: 'Yes ', adjudicator: 'claude'},
	{file: 'source/a.ts', line: '4', concept: 'count', decision: 'no', adjudicator: 'arie'},
	{file: 'source/a.ts', line: '5', concept: 'count', decision: '', adjudicator: ''},
];

test('readAdjudication maps each decided row to its decision and its adjudicator', () => {
	const decisions = readAdjudication(adjudicationRows);
	assert.deepEqual(decisions.get('source/a.ts:3|count'), {decision: 'yes', adjudicator: 'claude'});
	assert.deepEqual(decisions.get('source/a.ts:4|count'), {decision: 'no', adjudicator: 'arie'});
	assert.equal(decisions.has('source/a.ts:5|count'), false);
});

test('readAdjudication throws on a decision without an adjudicator, an unknown decision, a missing column, or a repeated row', () => {
	const row = {file: 'source/a.ts', line: '3', concept: 'count', decision: 'yes', adjudicator: 'claude'};
	assert.throws(() => readAdjudication([{...row, adjudicator: ' '}]), /adjudicator/);
	assert.throws(() => readAdjudication([{...row, decision: 'maybe'}]), /maybe/);
	const {adjudicator, ...withoutColumn} = row;
	assert.throws(() => readAdjudication([withoutColumn]), /adjudicator/);
	assert.throws(() => readAdjudication([row, {...row, decision: 'no'}]), /twice/);
});

test('usedAdjudicators lists who decided the disagreements the build used', () => {
	const decisions = readAdjudication(adjudicationRows);
	assert.deepEqual(usedAdjudicators(decisions, new Set(['source/a.ts:3|count', 'source/a.ts:4|count'])), ['arie', 'claude']);
});

test('usedAdjudicators throws on a decision that matches no disagreement', () => {
	const decisions = readAdjudication(adjudicationRows);
	assert.throws(() => usedAdjudicators(decisions, new Set(['source/a.ts:3|count'])), /source\/a\.ts:4\|count/);
});

test('truthStatement states whether the ground truth is final and who adjudicated it', () => {
	assert.equal(truthStatement({provisional: false, unresolvedDisagreements: 0, adjudicators: ['claude']}), 'Ground truth is final. Adjudicator: claude.');
	assert.equal(truthStatement({provisional: false, unresolvedDisagreements: 0, adjudicators: []}), 'Ground truth is final. No disagreement needed adjudication.');
	assert.equal(truthStatement({provisional: true, unresolvedDisagreements: 5, adjudicators: []}), 'Ground truth is provisional: 5 reviewer disagreements are unresolved. No disagreement has an adjudication yet.');
	assert.equal(truthStatement({provisional: true, unresolvedDisagreements: 2, adjudicators: ['arie', 'claude']}), 'Ground truth is provisional: 2 reviewer disagreements are unresolved. Adjudicators: arie, claude.');
	assert.throws(() => truthStatement({provisional: false, unresolvedDisagreements: 0}), /adjudicators/);
	assert.throws(() => truthStatement(undefined), /adjudicators/);
});

test('csv round-trips quoted fields', () => {
	const rows = [['a', 'b'], ['x,y', 'say "hi"\nthere']];
	const parsed = fromCsv(toCsv(rows));
	assert.deepEqual(parsed, [{a: 'x,y', b: 'say "hi"\nthere'}]);
});
