// Summarizes scored agent runs by version.
// Run it after a person has filled wrong_edits on the blind review sheet. The script reads that sheet first
// and the key, which maps run ids to versions, last; nothing before that read holds a version.
// Reads work/runs/scores.json (from score-agents.mjs), results/blind-review.csv, and work/runs/key.json.
// Writes results/agent-runs.json, results/agent-runs.csv, and results/agent-summary.md.
// Usage: node summarize-agents.mjs
import fs from 'node:fs';
import path from 'node:path';
import {agentSummaryRow, fisherExact, format, fromCsv, lineKindCells, lineKindRows, loadTasks, projectRoot, proposedVersion, publishedVersion, readJson, readLineKinds, readWrongEdits, successScore, toCsv, truthStatement, versions, workDir, writeJson} from './lib.mjs';

const config = loadTasks();
const truth = readJson(path.join(projectRoot, 'truth', 'truth.json'));
const {kinds} = readLineKinds(fs.readFileSync(path.join(projectRoot, 'docs', 'vocabulary.md'), 'utf8'));
const taskKind = taskId => config.tasks.find(task => task.id === taskId).kind;
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
const columns = ['runId', 'version', 'task', 'success', 'recall', 'missed', 'targetLines', 'otherSourceLinesChanged', 'testsRun', 'typecheck', 'testRegressions', 'hiddenTestPassed', 'wallSeconds', 'costUsd', 'turns', 'searchCalls', 'readCalls', 'agentError', 'wrongEdits', 'regressedTests', 'testFilesStoppedPartway', 'tools'];
// Three columns per line kind, in the line kinds table's order: the lines the task holds, true positives, and lines changed.
const kindColumns = kinds.flatMap(kind => [`${kind}Lines`, `${kind}TruePositives`, `${kind}Changed`]);
fs.writeFileSync(path.join(resultsDir, 'agent-runs.csv'), toCsv([[...columns, ...kindColumns], ...scored.map(row => [...columns.map(column => row[column]), ...lineKindCells(row, kinds, taskKind(row.task))])]));

const skipped = scored.filter(row => row.testsRun === false).length;
const unanswered = scored.filter(row => row.wrongEdits === null).length;
const unknown = scored.filter(row => row.success === null).length;
const runsPerCell = Math.max(...config.tasks.flatMap(task => versions.map(version => scored.filter(row => row.task === task.id && row.version === version).length)));
const lines = [
	'# Agent runs',
	'',
	truthStatement(truth),
	skipped > 0 ? `${skipped} edit runs were scored on recall only (--skip-tests): no type check, tests, or hidden test.` : 'Every edit run was type-checked and tested.',
	unanswered > 0 ? `${unanswered} of ${scored.length} runs have no wrong_edits answer on the blind review sheet.` : 'Every run has a wrong_edits answer on the blind review sheet.',
	...(unknown > 0 ? [`${unknown} edit runs had a test file that stopped partway during scoring, so their success is unknown. This script leaves them out of the success count, the interval, and p; rescore them.`] : []),
	'',
	`Success shows the count and its Wilson 95% interval. p is a two-sided Fisher exact test of success between versions; with at most ${runsPerCell} runs per task and version, only large gaps fall below 0.05. Wrong edits shows the runs marked yes over the runs answered; it does not change success.`,
	'',
	'| Task | Version | Runs | Success | 95% interval | p (published vs proposed) | Wrong edits | Mean recall | Mean lines missed | Median time (s) | Mean cost ($) | Mean search calls |',
	'|---|---|---|---|---|---|---|---|---|---|---|---|',
];
for (const task of config.tasks) {
	const byVersion = Object.fromEntries(versions.map(version => [version, scored.filter(row => row.task === task.id && row.version === version)]));
	const scores = Object.fromEntries(versions.map(version => [version, successScore(byVersion[version])]));
	const published = scores[publishedVersion];
	const proposed = scores[proposedVersion];
	const p = published && proposed
		? fisherExact(published.successes, published.runs - published.successes, proposed.successes, proposed.runs - proposed.successes)
		: null;
	for (const version of versions) {
		if (byVersion[version].length > 0) {
			lines.push(agentSummaryRow(task.id, version, byVersion[version], version === publishedVersion ? format(p, 3) : ''));
		}
	}
}

lines.push(
	'',
	'## Lines by line kind',
	'',
	'Lines counts the lines of each line kind the task holds: the ground truth lines for a find task, the target lines or required lines for an edit task. A line with two line kinds counts under both, so the counts can sum to more than the line total.',
	'',
	'| Task | Version | Line kind | Lines | Mean true positives | Mean changed |',
	'|---|---|---|---|---|---|',
);
for (const task of config.tasks) {
	for (const version of versions) {
		lines.push(...lineKindRows(task.id, version, scored.filter(row => row.task === task.id && row.version === version), kinds, task.kind));
	}
}

lines.push('');
fs.writeFileSync(path.join(resultsDir, 'agent-summary.md'), lines.join('\n'));
console.log(lines.join('\n'));
