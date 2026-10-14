// Scores agent runs, then unblinds them by version.
//   find tasks: find rate of the listed lines against the ground truth.
//   edit tasks: which concept lines (or required lines) the agent changed, which other lines it changed,
//               type checks, test regressions, and the hidden acceptance test if the task has one.
// Writes results/agent-runs.csv, results/agent-summary.md, and results/blind-review.csv
// (no version column; for a person to judge unexpected edits before looking at the key).
// Without --skip-tests, every run's copy and both versions' baseline test results must be present;
// a missing one stops the script rather than scoring the run on line coverage alone.
// Usage: node score-agents.mjs [--skip-tests]
import fs from 'node:fs';
import path from 'node:path';
import {changedOriginalLines, corpusFiles, fisherExact, hiddenTestPath, inCorpus, isHiddenTest, listedLines, loadCodebase, loadConcepts, loadTasks, percent, projectRoot, proposedVersion, publishedVersion, readJson, rerunTest, runChecked, shuffle, splitKey, toCsv, versionDir, versions, wilson, workDir, writeJson} from './lib.mjs';

const skipTests = process.argv.includes('--skip-tests');
const config = loadTasks();
const {concepts} = loadConcepts();
const truth = readJson(path.join(projectRoot, 'truth', 'truth.json'));
const runsDir = path.join(workDir, 'runs');
const runKey = readJson(path.join(runsDir, 'key.json'));
const resultsDir = path.join(projectRoot, 'results');
fs.mkdirSync(resultsDir, {recursive: true});

// Files an agent may name in a find reply, each with its line count: the published codebase's corpus
// when present. Without the checkout, every file in the truth, counted up to its highest truth line;
// a range past that line holds no truth line, so clipping it loses nothing.
const publishedRoot = versionDir(publishedVersion);
const knownFiles = new Map();
if (fs.existsSync(path.join(publishedRoot, loadCodebase().corpus.directory))) {
	for (const file of corpusFiles(publishedRoot)) {
		knownFiles.set(file, fs.readFileSync(path.join(publishedRoot, file), 'utf8').split('\n').length);
	}
} else {
	for (const entry of Object.values(truth.concepts)) {
		for (const line of entry.all) {
			const {file, line: number} = splitKey(line);
			knownFiles.set(file, Math.max(knownFiles.get(file) ?? 0, number));
		}
	}
}

const baseline = Object.fromEntries(versions.map(version => {
	const file = path.join(workDir, `tests-${version}.json`);
	if (fs.existsSync(file)) {
		return [version, readJson(file)];
	}

	if (!skipTests) {
		throw new Error(`Missing baseline ${file}: run scripts/run-tests.mjs ${version}, or pass --skip-tests to score line coverage only.`);
	}

	return [version, {tests: {}}];
}));

const knownFailing = new Set(Object.values(baseline).flatMap(result => Object.entries(result.tests).filter(([, passed]) => !passed).map(([name]) => name)));
const scored = [];
for (const [runId, {version, task: taskId}] of Object.entries(runKey)) {
	if (!versions.includes(version)) {
		throw new Error(`Run : the key names version "", expected one of . A run recorded before the versions were named needs a fresh run.`);
	}

	const runDir = path.join(runsDir, runId);
	const run = readJson(path.join(runDir, 'run.json'));
	const task = config.tasks.find(item => item.id === taskId);
	const concept = concepts.find(item => item.id === task.concept);
	const expected = new Set(truth.concepts[task.concept].all);
	const diff = fs.readFileSync(path.join(runDir, 'diff.patch'), 'utf8');
	const row = {
		runId,
		version,
		task: taskId,
		wallSeconds: Math.round(run.wallMs / 1000),
		costUsd: run.costUsd,
		turns: run.turns,
		agentError: run.isError || run.exitCode !== 0 || Boolean(run.runError),
		searchCalls: Object.entries(run.toolCounts).filter(([tool]) => /^(Grep|Glob|Bash:(rg|grep))$/.test(tool)).reduce((sum, [, count]) => sum + count, 0),
		readCalls: run.toolCounts.Read ?? 0,
		tools: JSON.stringify(run.toolCounts),
	};

	if (task.kind === 'find') {
		const listed = listedLines(fs.readFileSync(path.join(runDir, 'final.md'), 'utf8'), knownFiles);
		const found = [...listed].filter(item => expected.has(item));
		row.findRate = found.length / expected.size;
		row.missed = expected.size - found.length;
		row.success = row.missed === 0;
	} else {
		const changed = changedOriginalLines(diff);
		const sourceChanged = [...changed].filter(item => inCorpus(item));
		// Lines the agent had to change: the task's required lines, or for a rename, the concept's lines that
		// name it (a name the type checker found, or wording matching one of the concept's forms in that version).
		if (!task.requiredLines && !concept.forms) {
			throw new Error(`Concept ${concept.id} has no "forms" pattern in config/concepts.json, which task ${task.id} needs to pick its target lines.`);
		}

		const targets = new Set(task.requiredLines ?? [...expected].filter(item => {
			if (truth.concepts[task.concept].names.includes(item)) {
				return true;
			}

			const {file, line} = splitKey(item);
			const text = fs.readFileSync(path.join(versionDir(version), file), 'utf8').split('\n')[line - 1];
			return new RegExp(concept.forms, 'i').test(text);
		}));
		if (targets.size === 0) {
			throw new Error(`Task ${task.id} has no target lines in version ${version}.`);
		}

		row.targetLines = targets.size;
		row.missed = [...targets].filter(item => !changed.has(item)).length;
		row.otherSourceLinesChanged = sourceChanged.filter(item => !expected.has(item) && !targets.has(item)).length;
		row.findRate = (targets.size - row.missed) / targets.size;
		row.testsRun = !skipTests;

		if (!skipTests && !fs.existsSync(run.directory)) {
			throw new Error(`Run ${runId}: copy ${run.directory} is gone, so its tests cannot run. Pass --skip-tests to score line coverage only.`);
		}

		if (!skipTests) {
			// The hidden test lands in the codebase's test directory, where the test run picks it up.
			if (task.hiddenTest) {
				fs.copyFileSync(path.join(projectRoot, task.hiddenTest), hiddenTestPath(run.directory));
			}

			// An old result file is removed first, so a failed run cannot be scored from a stale one. Exit
			// status 1 with a fresh file means the type check failed, which is a result; no file means the run failed.
			const output = path.join(runDir, 'tests.json');
			fs.rmSync(output, {force: true});
			runChecked('node', [path.join(projectRoot, 'scripts', 'run-tests.mjs'), run.directory, output], {stdio: 'inherit'});
			if (!fs.existsSync(output)) {
				throw new Error(`Run ${runId}: the test run wrote no result in ${output}.`);
			}

			const tests = readJson(output);
			// A test that fails here but failed in either version's baseline, or passes on a rerun, is flaky, not a regression.
			const failing = Object.entries(tests.tests)
				.filter(([name, passed]) => !passed && !knownFailing.has(name) && !isHiddenTest(name))
				.map(([name]) => name)
				.filter(name => rerunTest(run.directory, name) === 0);
			row.typecheck = tests.typecheck;
			row.testRegressions = failing.length;
			row.regressedTests = failing.join('; ');
			if (task.hiddenTest) {
				const hidden = Object.entries(tests.tests).filter(([name]) => isHiddenTest(name));
				row.hiddenTestPassed = hidden.length > 0 && hidden.every(([, passed]) => passed);
			}

			row.success = row.typecheck && row.testRegressions === 0 && row.missed === 0 && (row.hiddenTestPassed ?? true);
		} else {
			row.success = row.missed === 0;
		}
	}

	scored.push(row);
}

// A failing test in one run may be a flaky timing test; regressions are listed per run for checking.
writeJson(path.join(resultsDir, 'agent-runs.json'), scored);
const columns = ['runId', 'version', 'task', 'success', 'findRate', 'missed', 'targetLines', 'otherSourceLinesChanged', 'testsRun', 'typecheck', 'testRegressions', 'hiddenTestPassed', 'wallSeconds', 'costUsd', 'turns', 'searchCalls', 'readCalls', 'agentError', 'regressedTests', 'tools'];
fs.writeFileSync(path.join(resultsDir, 'agent-runs.csv'), toCsv([columns, ...scored.map(row => columns.map(column => row[column]))]));

// Blind sheet: shuffled, no version.
const blind = shuffle(scored);
fs.writeFileSync(path.join(resultsDir, 'blind-review.csv'), toCsv([
	['runId', 'task', 'diff', 'final_reply', 'wrong_edits', 'notes'],
	...blind.map(row => [row.runId, row.task, path.join(runsDir, row.runId, 'diff.patch'), path.join(runsDir, row.runId, 'final.md'), '', '']),
]));

const mean = values => {
	const numbers = values.filter(value => typeof value === 'number' && !Number.isNaN(value));
	return numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
};

const median = values => {
	const numbers = values.filter(value => typeof value === 'number').sort((a, b) => a - b);
	return numbers.length === 0 ? null : numbers[Math.floor((numbers.length - 1) / 2)];
};

const format = (value, digits = 2) => value === null ? 'n/a' : value.toFixed(digits);
const skipped = scored.filter(row => row.testsRun === false).length;
const lines = [
	'# Agent runs',
	'',
	truth.provisional ? 'Ground truth is provisional.' : 'Ground truth is final.',
	skipped > 0 ? `${skipped} edit runs were scored on line coverage only (--skip-tests): no type check, tests, or hidden test.` : 'Every edit run was type-checked and tested.',
	'',
	'Success shows the count and its Wilson 95% interval. p is a two-sided Fisher exact test of success between versions; with ten runs per version, only large gaps fall below 0.05.',
	'',
	'| Task | Version | Runs | Success | 95% interval | p (published vs proposed) | Mean find rate | Mean lines missed | Median time (s) | Mean cost ($) | Mean search calls |',
	'|---|---|---|---|---|---|---|---|---|---|---|',
];
for (const task of config.tasks) {
	const byVersion = Object.fromEntries(versions.map(version => [version, scored.filter(row => row.task === task.id && row.version === version)]));
	const successes = Object.fromEntries(versions.map(version => [version, byVersion[version].filter(row => row.success).length]));
	const published = byVersion[publishedVersion];
	const proposed = byVersion[proposedVersion];
	const p = published.length > 0 && proposed.length > 0
		? fisherExact(successes[publishedVersion], published.length - successes[publishedVersion], successes[proposedVersion], proposed.length - successes[proposedVersion])
		: null;
	for (const version of versions) {
		const rows = byVersion[version];
		if (rows.length === 0) {
			continue;
		}

		const interval = wilson(successes[version], rows.length);
		lines.push(`| ${task.id} | ${version} | ${rows.length} | ${successes[version]}/${rows.length} | ${percent(interval.low)} to ${percent(interval.high)} | ${version === publishedVersion ? format(p, 3) : ''} | ${format(mean(rows.map(row => row.findRate)))} | ${format(mean(rows.map(row => row.missed)), 1)} | ${format(median(rows.map(row => row.wallSeconds)), 0)} | ${format(mean(rows.map(row => row.costUsd)))} | ${format(mean(rows.map(row => row.searchCalls)), 1)} |`);
	}
}

lines.push('');
fs.writeFileSync(path.join(resultsDir, 'agent-summary.md'), lines.join('\n'));
console.log(lines.join('\n'));
