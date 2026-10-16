// Self-tests for the helpers in helpers.mjs and lib.mjs. Run: node --test scripts/
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {agentSummaryRow, blindEditsReviewSheetRows, changedOriginalLines, editSuccess, findScore, isNameLine, kindTally, lineKindCells, lineKindOf, lineKindRows, readLineKinds, truthLines, fisherComparison, fromCsv, interleave, key, listedLines, matchesPublishedSearchPattern, mean, median, missingAgentTaskRuns, option, percent, readAdjudication, judgeLostVerificationTitles, lostReexecutionLimit, readLockedLines, readWrongEdits, editRegressionCandidates, renamedVerificationTitles, agentTaskRunMeasures, searchRates, shellCommandNames, shuffle, splitKey, successScore, summarizeTranscript, toCsv, truthStatement, usedAdjudicators, wilson} from './helpers.mjs';
import {commentLinesOfText, copyCodebase, diffSinceSnapshot, withheldAcceptanceTestPath, isWithheldAcceptanceTest, loadCodebase, loadTasks, makeAgentTaskRunCopy, proposedCodebaseVersion, publishedCodebaseVersion, codebaseVersions, workDir} from './lib.mjs';

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

test('codebaseVersions lists the published codebase first and the proposed codebase second', () => {
	assert.deepEqual(codebaseVersions, [publishedCodebaseVersion, proposedCodebaseVersion]);
});

test('withheldAcceptanceTestPath and isWithheldAcceptanceTest agree on the withheld acceptance test name', () => {
	const verificationTitle = path.basename(withheldAcceptanceTestPath('/copy'), '.test.ts');
	assert.ok(isWithheldAcceptanceTest(verificationTitle), verificationTitle);
	assert.ok(!isWithheldAcceptanceTest('retry.test'));
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

test('makeAgentTaskRunCopy copies a codebase version, commits it as the snapshot, and leaves a clean tree', () => {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'make-agent-task-run-copy-'));
	try {
		const source = path.join(scratch, 'source');
		fs.mkdirSync(path.join(source, 'src'), {recursive: true});
		fs.writeFileSync(path.join(source, 'src', 'a.ts'), 'export {};\n');
		fs.writeFileSync(path.join(source, '.gitignore'), 'node_modules/\n');
		const {directory, snapshot} = makeAgentTaskRunCopy(source, path.join(scratch, 'out', 'copy'));
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

test('agentTaskRunMeasures reads time, cost, turns, and tool counts of a local agent task run', () => {
	const agentTaskRun = {wallMs: 90_400, costUsd: 0.5, turns: 7, toolCounts: {Read: 3, Grep: 2, 'Bash:rg': 1, 'Bash:cat': 4}};
	assert.deepEqual(agentTaskRunMeasures(agentTaskRun), {wallSeconds: 90, costUsd: 0.5, turns: 7, agentSearchToolCalls: 3, readCalls: 3, tools: JSON.stringify(agentTaskRun.toolCounts)});
});

test('agentTaskRunMeasures gives null for what a cloud agent task run does not report', () => {
	const agentTaskRun = {wallMs: null, costUsd: null, turns: null, toolCounts: null};
	assert.deepEqual(agentTaskRunMeasures(agentTaskRun), {wallSeconds: null, costUsd: null, turns: null, agentSearchToolCalls: null, readCalls: null, tools: ''});
});

test('missingAgentTaskRuns lists the agent task runs each cell still needs, numbered after the agent task runs done', () => {
	const tasks = [{id: 't1'}, {id: 't2'}];
	const done = (task, codebaseVersion) => task.id === 't1' && codebaseVersion === 'a' ? 2 : 0;
	const jobs = missingAgentTaskRuns(tasks, ['a', 'b'], 3, done);
	assert.equal(jobs.length, (3 - 2) + 3 + 3 + 3);
	assert.deepEqual(jobs.filter(job => job.task.id === 't1' && job.codebaseVersion === 'a').map(job => job.index), [2]);
	assert.deepEqual(jobs.filter(job => job.task.id === 't2' && job.codebaseVersion === 'b').map(job => job.index), [0, 1, 2]);
});

test('shuffle returns a permutation and leaves the input alone', () => {
	const input = [1, 2, 3, 4, 5];
	const output = shuffle(input);
	assert.deepEqual(input, [1, 2, 3, 4, 5]);
	assert.deepEqual([...output].sort(), input);
});

const verificationSuite = loadCodebase().verificationSuite;
// One file of a diff with zero context lines: a single hunk holding the given removed and added lines.
const hunk = (file, lines) => {
	const count = sign => lines.filter(line => line.startsWith(sign)).length;
	return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, `@@ -1,${count('-')} +1,${count('+')} @@`, ...lines].join('\n');
};

test('renamedVerificationTitles maps the new verification title of a renamed verification declaration to its old verification title', () => {
	const diff = hunk('test/retry.ts', ["-test('retryCount is 1', async t => {", "+test('retryNumber is 1', async t => {"]);
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map([['retry › retryNumber is 1', 'retry › retryCount is 1']]));
});

test('renamedVerificationTitles pairs removed and added declarations in order within one hunk', () => {
	const diff = hunk('test/hooks.ts', [
		"-test('a retryCount', async t => {",
		'-	const retryCount = 1;',
		"-test.serial(\"b retryCount\", t => {",
		"+test('a retryNumber', async t => {",
		'+	const retryNumber = 1;',
		"+test.serial(\"b retryNumber\", t => {",
	]);
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map([['hooks › a retryNumber', 'hooks › a retryCount'], ['hooks › b retryNumber', 'hooks › b retryCount']]));
});

test('renamedVerificationTitles skips a hunk whose removed and added declaration counts differ', () => {
	const diff = hunk('test/retry.ts', ["-test('gone', t => {", "-test('also gone', t => {", "+test('added', t => {"]);
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map());
});

test('renamedVerificationTitles pairs declarations only within the same hunk', () => {
	const diff = [hunk('test/retry.ts', ["-test('gone', t => {"]), '@@ -20,0 +20,1 @@', "+test('added', t => {"].join('\n');
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map());
});

test('renamedVerificationTitles ignores files outside the verification folder, with another extension, or skipped', () => {
	const lines = ["-test('old', t => {", "+test('new', t => {"];
	const diff = [hunk('source/retry.ts', lines), hunk('test/retry.js', lines), hunk('test/browser.ts', lines)].join('\n');
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map());
});

test('renamedVerificationTitles reads backtick and escaped titles and skips a title with a template expression', () => {
	const diff = hunk('test/retry.ts', [
		"-test(`plain retryCount`, t => {",
		"-test('don\\'t retryCount', t => {",
		'-	test(`${name} retryCount`, t => {',
		"+test(`plain retryNumber`, t => {",
		"+test('don\\'t retryNumber', t => {",
		'+	test(`${name} retryNumber`, t => {',
	]);
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map([['retry › plain retryNumber', 'retry › plain retryCount'], ["retry › don't retryNumber", "retry › don't retryCount"]]));
});

test('renamedVerificationTitles reads a removed line that starts with dashes as a removed line, not a file header', () => {
	const diff = hunk('test/retry.ts', ['--- a/test/other.ts', "-test('old', t => {", "+test('new', t => {"]);
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map([['retry › new', 'retry › old']]));
});

test('renamedVerificationTitles maps nothing when a declaration keeps its title', () => {
	const diff = hunk('test/retry.ts', ["-test('same', async t => {", "+test('same', t => {"]);
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map());
});

test('renamedVerificationTitles reads the whole hunk when it holds no-newline markers', () => {
	const marker = '\\ No newline at end of file';
	const diff = hunk('test/retry.ts', ["-test('a', t => {", "-test('b', t => {", marker, "+test('c', t => {", "+test('d', t => {", marker]);
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map([['retry › c', 'retry › a'], ['retry › d', 'retry › b']]));
});

test('renamedVerificationTitles uses the old path for removed declarations and the new path for added ones', () => {
	const diff = ['diff --git a/test/old.ts b/test/new.ts', 'similarity index 90%', 'rename from test/old.ts', 'rename to test/new.ts', '--- a/test/old.ts', '+++ b/test/new.ts', '@@ -1 +1 @@', "-test('x', t => {", "+test('y', t => {"].join('\n');
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map([['new › y', 'old › x']]));
});

test('renamedVerificationTitles pairs nothing in a new or a deleted verification file', () => {
	const diff = [
		'diff --git a/test/added.ts b/test/added.ts', 'new file mode 100644', '--- /dev/null', '+++ b/test/added.ts', '@@ -0,0 +1 @@', "+test('x', t => {",
		'diff --git a/test/gone.ts b/test/gone.ts', 'deleted file mode 100644', '--- a/test/gone.ts', '+++ /dev/null', '@@ -1 +0,0 @@', "-test('y', t => {",
	].join('\n');
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map());
});

test('renamedVerificationTitles reads a path that git ends with a tab', () => {
	const diff = ['diff --git a/test/my file.ts b/test/my file.ts', '--- a/test/my file.ts\t', '+++ b/test/my file.ts\t', '@@ -1 +1 @@', "-test('x', t => {", "+test('y', t => {"].join('\n');
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map([['my file › y', 'my file › x']]));
});

test('renamedVerificationTitles throws on a file header it cannot read, such as a quoted path', () => {
	const diff = [hunk('test/a.ts', ["-test('p', t => {", "+test('q', t => {"]), 'diff --git "a/test/\\303\\251.ts" "b/test/\\303\\251.ts"', '--- "a/test/\\303\\251.ts"', '+++ "b/test/\\303\\251.ts"', '@@ -1 +1 @@', "-test('r', t => {", "+test('s', t => {"].join('\n');
	assert.throws(() => renamedVerificationTitles(diff, verificationSuite), /cannot read the file header/);
});

test('renamedVerificationTitles skips a quoted path outside the verification folder', () => {
	const diff = ['diff --git "a/source/\\303\\251.ts" "b/source/\\303\\251.ts"', '--- "a/source/\\303\\251.ts"', '+++ "b/source/\\303\\251.ts"', '@@ -1 +1 @@', '-const a = 1;', '+const b = 1;', hunk('test/a.ts', ["-test('p', t => {", "+test('q', t => {"])].join('\n');
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map([['a › q', 'a › p']]));
});

test('renamedVerificationTitles skips a title with an escape other than a quote or a backslash', () => {
	const diff = hunk('test/retry.ts', ["-test('line\\nbreak', t => {", "+test('line\\nbreaks', t => {"]);
	assert.deepEqual(renamedVerificationTitles(diff, verificationSuite), new Map());
});

test('editRegressionCandidates re-executes a passing individual codebase verification that fails and lists the lost verification titles of its verification file', () => {
	const preEditResults = {'a › passes': true, 'a › fails': true, 'a › vanishes': true, 'a › was failing': false};
	const agentTaskRunResults = {'a › passes': true, 'a › fails': false, 'a › was failing': false};
	assert.deepEqual(editRegressionCandidates(preEditResults, agentTaskRunResults, new Map(), ' › '), {reexecute: ['a › fails'], files: [{file: 'a', lostVerificationTitles: ['a › vanishes']}]});
});

test('editRegressionCandidates skips a failing individual codebase verification that the pre-edit codebase verification suite results lack', () => {
	assert.deepEqual(editRegressionCandidates({'a › old': true}, {'a › old': true, 'a › new': false}, new Map(), ' › '), {reexecute: [], files: []});
});

test('editRegressionCandidates judges a renamed verification by its result under the new verification title', () => {
	const renamedVerifications = new Map([['a › retryNumber is 1', 'a › retryCount is 1']]);
	const preEditResults = {'a › retryCount is 1': true, 'a › other': true};
	assert.deepEqual(editRegressionCandidates(preEditResults, {'a › retryNumber is 1': false, 'a › other': true}, renamedVerifications, ' › '), {reexecute: ['a › retryNumber is 1'], files: []});
	assert.deepEqual(editRegressionCandidates(preEditResults, {'a › retryNumber is 1': true, 'a › other': true}, renamedVerifications, ' › '), {reexecute: [], files: []});
});

test('editRegressionCandidates ignores a renamed verification that failed in the pre-edit codebase verification suite results and still fails', () => {
	assert.deepEqual(editRegressionCandidates({'a › was failing': false}, {'a › renamed': false}, new Map([['a › renamed', 'a › was failing']]), ' › '), {reexecute: [], files: []});
});

test('editRegressionCandidates lists the lost verification title of a renamed verification under its new verification title', () => {
	assert.deepEqual(editRegressionCandidates({'a › old': true}, {}, new Map([['a › new', 'a › old']]), ' › '), {reexecute: [], files: [{file: 'a', lostVerificationTitles: ['a › new']}]});
});

test('editRegressionCandidates counts a new verification title with no pair as a lost verification title plus a new verification title', () => {
	assert.deepEqual(editRegressionCandidates({'a › old': true}, {'a › new': true}, new Map(), ' › '), {reexecute: [], files: [{file: 'a', lostVerificationTitles: ['a › old']}]});
});

test('editRegressionCandidates groups by the text before the first separator and handles a verification title named __proto__', () => {
	const preEditResults = {'a › b › c': true, 'a › __proto__': true};
	assert.deepEqual(editRegressionCandidates(preEditResults, {}, new Map(), ' › '), {reexecute: [], files: [{file: 'a', lostVerificationTitles: ['a › b › c', 'a › __proto__']}]});
});

test('judgeLostVerificationTitles marks a verification file that stopped partway and counts the failed re-executions before the pass as removed verifications', () => {
	const results = [false, false, true];
	assert.deepEqual(judgeLostVerificationTitles(['a › gone', 'a › gone too', 'a › present', 'a › other'], () => results.shift()), {removedVerifications: 2, stoppedPartway: true});
});

test('judgeLostVerificationTitles counts every lost verification title as a removed verification when all re-executions fail', () => {
	assert.deepEqual(judgeLostVerificationTitles(['a › x', 'a › y', 'a › z'], () => false), {removedVerifications: 3, stoppedPartway: false});
});

test('judgeLostVerificationTitles stops after the lost re-execution limit of failed re-executions', () => {
	const lost = Array.from({length: 100}, (_, i) => `a › t${i}`);
	let reexecutions = 0;
	assert.deepEqual(judgeLostVerificationTitles(lost, () => {
		reexecutions++;
		return false;
	}), {removedVerifications: 100, stoppedPartway: false});
	assert.equal(reexecutions, lostReexecutionLimit);
});

test('blindEditsReviewSheetRows keeps the rows already on the sheet and appends only agent task runs it lacks', () => {
	const existing = [{agentTaskRunId: 'r1', task: 't', diff: 'd1', final_reply: 'f1', wrong_edits: 'yes', notes: 'odd'}];
	const agentTaskRuns = [
		{agentTaskRunId: 'r1', task: 't', diff: 'd1', finalReply: 'f1'},
		{agentTaskRunId: 'r2', task: 't', diff: 'd2', finalReply: 'f2'},
	];
	assert.deepEqual(blindEditsReviewSheetRows(existing, agentTaskRuns), [
		['r1', 't', 'd1', 'f1', 'yes', 'odd'],
		['r2', 't', 'd2', 'f2', '', ''],
	]);
});

test('blindEditsReviewSheetRows throws on an existing row that lacks a column', () => {
	assert.throws(() => blindEditsReviewSheetRows([{agentTaskRunId: 'r1'}], []), /lacks the task column/);
});

test('readWrongEdits maps yes, no, and blank to true, false, and null', () => {
	const rows = [{agentTaskRunId: 'a', wrong_edits: 'Yes'}, {agentTaskRunId: 'b', wrong_edits: ' no '}, {agentTaskRunId: 'c', wrong_edits: ''}];
	assert.deepEqual([...readWrongEdits(rows, ['a', 'b', 'c'])], [['a', true], ['b', false], ['c', null]]);
});

test('readWrongEdits throws on another value, a repeated agent task run, or an agent task run missing from the sheet', () => {
	assert.throws(() => readWrongEdits([{agentTaskRunId: 'a', wrong_edits: 'maybe'}], ['a']), /maybe/);
	assert.throws(() => readWrongEdits([{agentTaskRunId: 'a', wrong_edits: ''}, {agentTaskRunId: 'a', wrong_edits: ''}], ['a']), /twice/);
	assert.throws(() => readWrongEdits([{agentTaskRunId: 'a', wrong_edits: ''}], ['a', 'b']), /b/);
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

test('findScore reports the recall, the lines missed, and success when none is missed', () => {
	const expected = new Set(['a:1', 'a:2', 'a:3', 'a:4']);
	assert.deepEqual(findScore(new Set(['a:1', 'a:2', 'a:9']), expected), {recall: 0.5, missed: 2, success: false});
	assert.deepEqual(findScore(new Set(['a:1', 'a:2', 'a:3', 'a:4', 'a:9']), expected), {recall: 1, missed: 0, success: true});
});

test('findScore throws when the ground truth lists no line for the concept', () => {
	assert.throws(() => findScore(new Set(['a:1']), new Set()), /no line/);
});

test('truthLines returns the lines of one concept and isNameLine tells a name line from a text line', () => {
	const entry = {lines: {'a.ts:2': ['property'], 'a.ts:5': ['comment'], 'a.ts:7': ['string'], 'b.ts:1': ['comment', 'parameter']}};
	assert.deepEqual(truthLines(entry), ['a.ts:2', 'a.ts:5', 'a.ts:7', 'b.ts:1']);
	assert.equal(isNameLine(entry, 'a.ts:2'), true);
	assert.equal(isNameLine(entry, 'a.ts:5'), false);
	assert.equal(isNameLine(entry, 'a.ts:7'), false);
	assert.equal(isNameLine(entry, 'b.ts:1'), true);
	assert.equal(isNameLine(entry, 'c.ts:9'), false);
});

const lineKindsDoc = [
	'## Ground truth',
	'',
	'### Line kinds',
	'',
	'Intro text.',
	'',
	'| Kind | Meaning | TypeScript kinds | Retired |',
	'|---|---|---|---|',
	'| comment | A comment. | | remark |',
	'| string | A string. | | |',
	'| property | A property. | property, getter | attribute |',
	'| other | Anything else. | | misc |',
	'',
	'## Agent task runs',
].join('\n');

test('readLineKinds reads the line kinds in table order and the mapping from declaration kind to line kind', () => {
	const {kinds, mapping} = readLineKinds(lineKindsDoc);
	assert.deepEqual(kinds, ['comment', 'string', 'property', 'other']);
	assert.deepEqual([...mapping], [['property', 'property'], ['getter', 'property']]);
});

test('readLineKinds throws on a missing table, a missing column, no rows, no TypeScript kinds, a missing comment, string, or other row, and a short row', () => {
	assert.throws(() => readLineKinds('## Ground truth\n'), /Line kinds/);
	assert.throws(() => readLineKinds(lineKindsDoc.replace('TypeScript kinds', 'TS kinds')), /TypeScript kinds/);
	assert.throws(() => readLineKinds(lineKindsDoc.replace(/\| (comment|string|property|other) \|.*\n/g, '')), /no rows/);
	assert.throws(() => readLineKinds(lineKindsDoc.replace('property, getter', '')), /no TypeScript kinds/);
	assert.throws(() => readLineKinds(lineKindsDoc.replace('| other | Anything else. | | misc |', '| misc | Anything else. | | |')), /other/);
	assert.throws(() => readLineKinds(lineKindsDoc.replace('| string | A string. | | |', '| string |')), /cells/);
});

test('readLineKinds reads the line kinds table in docs/vocabulary.md', () => {
	const {kinds, mapping} = readLineKinds(fs.readFileSync(new URL('../docs/vocabulary.md', import.meta.url), 'utf8'));
	assert.deepEqual(kinds, ['comment', 'string', 'property', 'parameter', 'variable', 'function', 'type', 'other']);
	assert.equal(mapping.get('enum member'), 'property');
	assert.equal(mapping.get('local var'), 'variable');
});

test('lineKindOf maps a declaration kind to its line kind and an unlisted one to other', () => {
	const {mapping} = readLineKinds(lineKindsDoc);
	assert.equal(lineKindOf('getter', mapping), 'property');
	assert.equal(lineKindOf('module', mapping), 'other');
});

test('kindTally counts the lines of each line kind and how many of them are done, counting a two-kind line under both', () => {
	const kindsByLine = {'a.ts:1': ['comment'], 'a.ts:2': ['property'], 'a.ts:3': ['comment', 'property'], 'a.ts:4': ['string']};
	assert.deepEqual(kindTally(['a.ts:1', 'a.ts:2', 'a.ts:3'], new Set(['a.ts:3', 'z.ts:9']), kindsByLine), {
		comment: {lines: 2, done: 1},
		property: {lines: 2, done: 1},
	});
});

test('lineKindCells gives three cells per line kind and leaves true positives empty for an edit task and changed empty for a find task', () => {
	const byKind = {comment: {lines: 3, done: 2}};
	assert.deepEqual(lineKindCells({byKind}, ['comment', 'property'], 'find'), [3, 2, '', '', '', '']);
	assert.deepEqual(lineKindCells({byKind}, ['comment', 'property'], 'edit'), [3, '', 2, '', '', '']);
	assert.deepEqual(lineKindCells({}, ['comment'], 'find'), ['', '', '']);
});

test('lineKindRows gives one row per line kind the cell holds, with the lines and the mean true positives or lines changed', () => {
	const agentTaskRuns = [{byKind: {comment: {lines: 4, done: 1}, property: {lines: 2, done: 2}}}, {byKind: {comment: {lines: 4, done: 2}, property: {lines: 2, done: 2}}}];
	assert.deepEqual(lineKindRows('find-all', 'published', agentTaskRuns, ['comment', 'string', 'property'], 'find'), [
		'| find-all | published | comment | 4 | 1.5 |  |',
		'| find-all | published | property | 2 | 2.0 |  |',
	]);
	assert.deepEqual(lineKindRows('rename', 'proposed', agentTaskRuns.slice(0, 1), ['comment'], 'edit'), ['| rename | proposed | comment | 4 |  | 1.0 |']);
});

test('kindTally throws on a line with no line kind', () => {
	assert.throws(() => kindTally(['a.ts:8'], new Set(), {}), /a\.ts:8/);
});

test('matchesPublishedSearchPattern checks the text of a line and never the text of a missing line', () => {
	const lines = ['const retry = 1;', 'other'];
	assert.equal(matchesPublishedSearchPattern(lines, 1, 'retry'), true);
	assert.equal(matchesPublishedSearchPattern(lines, 2, 'retry'), false);
	assert.equal(matchesPublishedSearchPattern(lines, 3, 'undefined'), false);
	assert.equal(matchesPublishedSearchPattern(lines, 0, 'undefined'), false);
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

test('fisherComparison matches known values', () => {
	assert.ok(Math.abs(fisherComparison(0, 10, 9, 1) - 0.000_119_08) < 1e-7);
	assert.ok(Math.abs(fisherComparison(9, 1, 6, 4) - 0.303) < 0.002);
	assert.equal(fisherComparison(5, 5, 5, 5), 1);
});

test('mean averages the numbers in a list, skips other values, and gives null for none', () => {
	assert.equal(mean([1, 2, null, 'x', 6]), 3);
	assert.equal(mean([null]), null);
	assert.equal(mean([]), null);
});

test('successScore counts successes over agent task runs with the Wilson interval, and gives null for no agent task runs', () => {
	const score = successScore([{success: true}, {success: false}, {success: true}, {success: true}]);
	assert.equal(score.successes, 3);
	assert.equal(score.agentTaskRuns, 4);
	assert.equal(score.score, 0.75);
	assert.deepEqual(score.interval, wilson(3, 4));
	assert.equal(successScore([]), null);
});

test('successScore leaves out agent task runs with unknown success, and gives null when every agent task run is unknown', () => {
	const score = successScore([{success: true}, {success: null}, {success: false}]);
	assert.equal(score.successes, 1);
	assert.equal(score.agentTaskRuns, 2);
	assert.equal(successScore([{success: null}]), null);
});

test('agentSummaryRow shows the agent task runs, the success count, and the means of a cell', () => {
	const agentTaskRuns = [{success: true, wrongEdits: false, recall: 1, missed: 0, wallSeconds: 10, costUsd: 0.5, agentSearchToolCalls: 2}, {success: false, wrongEdits: null, recall: 0.5, missed: 2, wallSeconds: 20, costUsd: 1.5, agentSearchToolCalls: 4}];
	assert.equal(agentSummaryRow('rename', 'published', agentTaskRuns, '0.500'), '| rename | published | 2 | 1/2 | 9% to 91% | 0.500 | 0/1 | 0.75 | 1.0 | 15 | 1.00 | 3.0 |');
});

test('agentSummaryRow keeps a cell whose every agent task run has unknown success, with n/a for the success and the interval', () => {
	const agentTaskRuns = [{success: null, wrongEdits: true, recall: 1, missed: 0, wallSeconds: 10, costUsd: 1, agentSearchToolCalls: 2}];
	assert.equal(agentSummaryRow('rename', 'proposed', agentTaskRuns, ''), '| rename | proposed | 1 | n/a | n/a |  | 1/1 | 1.00 | 0.0 | 10 | 1.00 | 2.0 |');
});

const scoredEditAgentTaskRun = {typecheck: true, editRegressions: 0, missed: 0, verificationFilesStoppedPartway: ''};

test('editSuccess is true when the type check passes and no edit regression, nothing was missed, and the withheld acceptance test did not fail', () => {
	assert.equal(editSuccess(scoredEditAgentTaskRun), true);
	assert.equal(editSuccess({...scoredEditAgentTaskRun, withheldAcceptanceTestPassed: true}), true);
	assert.equal(editSuccess({...scoredEditAgentTaskRun, withheldAcceptanceTestPassed: false}), false);
	assert.equal(editSuccess({...scoredEditAgentTaskRun, typecheck: false}), false);
	assert.equal(editSuccess({...scoredEditAgentTaskRun, editRegressions: 1}), false);
	assert.equal(editSuccess({...scoredEditAgentTaskRun, missed: 1}), false);
});

test('editSuccess is unknown for an agent task run with a verification file that stopped partway, whatever else it scored', () => {
	assert.equal(editSuccess({...scoredEditAgentTaskRun, verificationFilesStoppedPartway: 'retry'}), null);
	assert.equal(editSuccess({...scoredEditAgentTaskRun, missed: 1, verificationFilesStoppedPartway: 'retry'}), null);
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
	assert.equal(truthStatement({provisional: true, unresolvedDisagreements: 5, adjudicators: []}), 'Ground truth is provisional: 5 tagger disagreements are unresolved. No disagreement has an adjudication yet.');
	assert.equal(truthStatement({provisional: true, unresolvedDisagreements: 2, adjudicators: ['arie', 'claude']}), 'Ground truth is provisional: 2 tagger disagreements are unresolved. Adjudicators: arie, claude.');
	assert.throws(() => truthStatement({provisional: false, unresolvedDisagreements: 0}), /adjudicators/);
	assert.throws(() => truthStatement(undefined), /adjudicators/);
});

test('readLockedLines maps each concept to the line keys of its locked lines', () => {
	const lines = new Map([['source/a.ts:3', '\tsignal.throwIfAborted();'], ['source/b.ts:7', 'const delay = 5;']]);
	const concepts = [
		{id: 'user-abort', lockedLines: [{file: 'source/a.ts', line: 3, text: 'throwIfAborted', reason: 'standard library name'}]},
		{id: 'jitter', lockedLines: []},
	];
	const locked = readLockedLines(concepts, (file, line) => lines.get(key(file, line)));
	assert.deepEqual([...locked], [['user-abort', new Set(['source/a.ts:3'])], ['jitter', new Set()]]);
});

test('searchRates scores true positives against the ground truth lines and the hits', () => {
	const expected = new Set(['a.ts:1', 'a.ts:2', 'a.ts:3', 'a.ts:4']);
	const hits = new Set(['a.ts:1', 'a.ts:2', 'a.ts:9']);
	assert.deepEqual(searchRates(expected, hits, new Set()), {truePositives: 2, truthLines: 4, hits: 3, recall: 0.5, precision: 2 / 3, missed: ['a.ts:3', 'a.ts:4']});
});

test('searchRates leaves locked lines out of the ground truth lines, the hits, and the misses', () => {
	const expected = new Set(['a.ts:1', 'a.ts:2', 'a.ts:3']);
	const hits = new Set(['a.ts:1', 'a.ts:2', 'a.ts:9']);
	const locked = new Set(['a.ts:3', 'a.ts:9']);
	assert.deepEqual(searchRates(expected, hits, locked), {truePositives: 2, truthLines: 2, hits: 2, recall: 1, precision: 1, missed: []});
});

test('searchRates gives no ratio when locked lines leave nothing to divide by', () => {
	const rates = searchRates(new Set(['a.ts:1']), new Set(['a.ts:1']), new Set(['a.ts:1']));
	assert.equal(rates.recall, null);
	assert.equal(rates.precision, null);
});

test('csv round-trips quoted fields', () => {
	const rows = [['a', 'b'], ['x,y', 'say "hi"\nthere']];
	const parsed = fromCsv(toCsv(rows));
	assert.deepEqual(parsed, [{a: 'x,y', b: 'say "hi"\nthere'}]);
});
