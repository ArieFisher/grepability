// Summarizes scored agent runs by version.
// Run it after a person has filled wrong_edits on the blind review sheet. The script reads that sheet first
// and the key, which maps run ids to versions, last; nothing before that read holds a version.
// Reads work/runs/scores.json (from score-agents.mjs), results/blind-review.csv, and work/runs/key.json.
// Writes results/agent-runs.json, results/agent-runs.csv, and results/agent-summary.md.
// Usage: node summarize-agents.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fisherExact, fromCsv, loadTasks, median, percent, projectRoot, proposedVersion, publishedVersion, readJson, readWrongEdits, toCsv, versions, wilson, workDir, writeJson} from './lib.mjs';

const config = loadTasks();
const truth = readJson(path.join(projectRoot, 'truth', 'truth.json'));
const runsDir = path.join(workDir, 'runs');
const resultsDir = path.join(projectRoot, 'results');
const scoresFile = path.join(runsDir, 'scores.json');
const sheetFile = path.join(resultsDir, 'blind-review.csv');
for (const file of [scoresFile, sheetFile]) {
	if (!fs.existsSync(file)) {
		throw new Error(`Missing ${file}: run scripts/score-agents.mjs first.`);
	}
}

const scores = readJson(scoresFile);
const wrongEdits = readWrongEdits(fromCsv(fs.readFileSync(sheetFile, 'utf8')), scores.map(row => row.runId));

const runKey = readJson(path.join(runsDir, 'key.json'));
const scored = scores.map(row => {
	const entry = runKey[row.runId];
	if (!entry || !versions.includes(entry.version)) {
		throw new Error(`Run ${row.runId}: the key holds no known version (expected one of ${versions.join(', ')}).`);
	}

	return {runId: row.runId, version: entry.version, ...row, wrongEdits: wrongEdits.get(row.runId)};
});

// A failing test in one run may be a flaky timing test; regressions are listed per run for checking.
writeJson(path.join(resultsDir, 'agent-runs.json'), scored);
const columns = ['runId', 'version', 'task', 'success', 'findRate', 'missed', 'targetLines', 'otherSourceLinesChanged', 'testsRun', 'typecheck', 'testRegressions', 'hiddenTestPassed', 'wallSeconds', 'costUsd', 'turns', 'searchCalls', 'readCalls', 'agentError', 'wrongEdits', 'regressedTests', 'tools'];
fs.writeFileSync(path.join(resultsDir, 'agent-runs.csv'), toCsv([columns, ...scored.map(row => columns.map(column => row[column]))]));

const mean = values => {
	const numbers = values.filter(value => typeof value === 'number' && !Number.isNaN(value));
	return numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
};

const format = (value, digits = 2) => value === null ? 'n/a' : value.toFixed(digits);
const skipped = scored.filter(row => row.testsRun === false).length;
const unanswered = scored.filter(row => row.wrongEdits === null).length;
const runsPerCell = Math.max(...config.tasks.flatMap(task => versions.map(version => scored.filter(row => row.task === task.id && row.version === version).length)));
const lines = [
	'# Agent runs',
	'',
	truth.provisional ? 'Ground truth is provisional.' : 'Ground truth is final.',
	skipped > 0 ? `${skipped} edit runs were scored on find rate only (--skip-tests): no type check, tests, or hidden test.` : 'Every edit run was type-checked and tested.',
	unanswered > 0 ? `${unanswered} of ${scored.length} runs have no wrong_edits answer on the blind review sheet.` : 'Every run has a wrong_edits answer on the blind review sheet.',
	'',
	'Success shows the count and its Wilson 95% interval. p is a two-sided Fisher exact test of success between versions; with at most ${runsPerCell} runs per task and version, only large gaps fall below 0.05. Wrong edits shows the runs marked yes over the runs answered; it does not change success.',
	'',
	'| Task | Version | Runs | Success | 95% interval | p (published vs proposed) | Wrong edits | Mean find rate | Mean lines missed | Median time (s) | Mean cost ($) | Mean search calls |',
	'|---|---|---|---|---|---|---|---|---|---|---|---|',
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
		const answered = rows.filter(row => row.wrongEdits !== null);
		const flagged = answered.filter(row => row.wrongEdits).length;
		lines.push(`| ${task.id} | ${version} | ${rows.length} | ${successes[version]}/${rows.length} | ${percent(interval.low)} to ${percent(interval.high)} | ${version === publishedVersion ? format(p, 3) : ''} | ${flagged}/${answered.length} | ${format(mean(rows.map(row => row.findRate)))} | ${format(mean(rows.map(row => row.missed)), 1)} | ${format(median(rows.map(row => row.wallSeconds)), 0)} | ${format(mean(rows.map(row => row.costUsd)))} | ${format(mean(rows.map(row => row.searchCalls)), 1)} |`);
	}
}

lines.push('');
fs.writeFileSync(path.join(resultsDir, 'agent-summary.md'), lines.join('\n'));
console.log(lines.join('\n'));
