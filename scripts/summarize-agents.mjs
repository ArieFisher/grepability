// Summarizes scored agent task runs by codebase version.
// Run it after a person has filled wrong_edits on the blind edits-review sheet. The script reads that sheet first
// and the key, which maps agent task run ids to codebase versions, last; nothing before that read holds a codebase
// version.
// Reads work/agent-task-runs/scores.json (from score-agents.mjs), results/blind-edits-review.csv, and
// work/agent-task-runs/key.json.
// Writes results/agent-task-runs.json, results/agent-task-runs.csv, and results/agent-summary.md.
// Usage: node summarize-agents.mjs
import fs from 'node:fs';
import path from 'node:path';
import {agentSummaryRow, codebaseVersions, fisherComparison, format, fromCsv, lineKindCells, lineKindRows, loadTasks, projectRoot, proposedCodebaseVersion, publishedCodebaseVersion, readJson, readLineKinds, readWrongEdits, successScore, toCsv, truthStatement, workDir, writeJson} from './lib.mjs';

const config = loadTasks();
const truth = readJson(path.join(projectRoot, 'truth', 'truth.json'));
const {kinds} = readLineKinds(fs.readFileSync(path.join(projectRoot, 'docs', 'vocabulary.md'), 'utf8'));
const taskKind = taskId => config.tasks.find(task => task.id === taskId).kind;
const agentTaskRunsDir = path.join(workDir, 'agent-task-runs');
const resultsDir = path.join(projectRoot, 'results');
const scoresFile = path.join(agentTaskRunsDir, 'scores.json');
const sheetFile = path.join(resultsDir, 'blind-edits-review.csv');
for (const file of [scoresFile, sheetFile]) {
	if (!fs.existsSync(file)) {
		throw new Error(`Missing ${file}: run scripts/score-agents.mjs first.`);
	}
}

const scores = readJson(scoresFile);
const wrongEdits = readWrongEdits(fromCsv(fs.readFileSync(sheetFile, 'utf8')), scores.map(row => row.agentTaskRunId));

const agentTaskRunKey = readJson(path.join(agentTaskRunsDir, 'key.json'));
const scored = scores.map(row => {
	const entry = agentTaskRunKey[row.agentTaskRunId];
	if (!entry || !codebaseVersions.includes(entry.codebaseVersion)) {
		throw new Error(`Agent task run ${row.agentTaskRunId}: the key holds no known codebase version (expected one of ${codebaseVersions.join(', ')}).`);
	}

	return {agentTaskRunId: row.agentTaskRunId, codebaseVersion: entry.codebaseVersion, ...row, wrongEdits: wrongEdits.get(row.agentTaskRunId)};
});

// A failing individual codebase verification in one agent task run may be a flaky verification that depends on timing; the table
// lists the edit regressions of each agent task run for checking.
writeJson(path.join(resultsDir, 'agent-task-runs.json'), scored);
const columns = ['agentTaskRunId', 'codebaseVersion', 'task', 'success', 'recall', 'missed', 'targetLines', 'otherSourceLinesChanged', 'verificationSuiteExecuted', 'typecheck', 'editRegressions', 'withheldAcceptanceTestPassed', 'wallSeconds', 'costUsd', 'turns', 'agentSearchToolCalls', 'readCalls', 'agentError', 'wrongEdits', 'regressedVerifications', 'verificationFilesStoppedPartway', 'tools'];
// Three columns per line kind, in the line kinds table's order: the lines the task holds, true positives, and lines changed.
const kindColumns = kinds.flatMap(kind => [`${kind}Lines`, `${kind}TruePositives`, `${kind}Changed`]);
fs.writeFileSync(path.join(resultsDir, 'agent-task-runs.csv'), toCsv([[...columns, ...kindColumns], ...scored.map(row => [...columns.map(column => row[column]), ...lineKindCells(row, kinds, taskKind(row.task))])]));

const skipped = scored.filter(row => row.verificationSuiteExecuted === false).length;
const unanswered = scored.filter(row => row.wrongEdits === null).length;
const unknown = scored.filter(row => row.success === null).length;
const agentTaskRunsPerCell = Math.max(...config.tasks.flatMap(task => codebaseVersions.map(codebaseVersion => scored.filter(row => row.task === task.id && row.codebaseVersion === codebaseVersion).length)));
const lines = [
	'# Agent task runs',
	'',
	truthStatement(truth),
	skipped > 0 ? `${skipped} agent task runs of edit tasks were scored on recall only (--skip-verification-suite): no type check, codebase verification suite, or withheld acceptance test.` : 'Every agent task run of an edit task was type-checked and verified with the codebase verification suite.',
	unanswered > 0 ? `${unanswered} of ${scored.length} agent task runs have no wrong_edits answer on the blind edits-review sheet.` : 'Every agent task run has a wrong_edits answer on the blind edits-review sheet.',
	...(unknown > 0 ? [`${unknown} agent task runs of edit tasks had a verification file that stopped partway during scoring, so their success is unknown. This script leaves them out of the success count, the interval, and the Fisher comparison (p); rescore them.`] : []),
	'',
	`Success shows the count and its Wilson 95% interval. The Fisher comparison (p) is two-sided, of success between codebase versions; with at most ${agentTaskRunsPerCell} agent task runs per task and codebase version, only large gaps fall below 0.05. Wrong edits shows the agent task runs marked yes over the agent task runs answered; it does not change success.`,
	'',
	'| Task | Codebase version | Agent task runs | Success | 95% interval | Fisher comparison (p), published vs proposed | Wrong edits | Mean recall | Mean lines missed | Median time (s) | Mean cost ($) | Mean agent search tool calls |',
	'|---|---|---|---|---|---|---|---|---|---|---|---|',
];
for (const task of config.tasks) {
	const byCodebaseVersion = Object.fromEntries(codebaseVersions.map(codebaseVersion => [codebaseVersion, scored.filter(row => row.task === task.id && row.codebaseVersion === codebaseVersion)]));
	const scores = Object.fromEntries(codebaseVersions.map(codebaseVersion => [codebaseVersion, successScore(byCodebaseVersion[codebaseVersion])]));
	const published = scores[publishedCodebaseVersion];
	const proposed = scores[proposedCodebaseVersion];
	const p = published && proposed
		? fisherComparison(published.successes, published.agentTaskRuns - published.successes, proposed.successes, proposed.agentTaskRuns - proposed.successes)
		: null;
	for (const codebaseVersion of codebaseVersions) {
		if (byCodebaseVersion[codebaseVersion].length > 0) {
			lines.push(agentSummaryRow(task.id, codebaseVersion, byCodebaseVersion[codebaseVersion], codebaseVersion === publishedCodebaseVersion ? format(p, 3) : ''));
		}
	}
}

lines.push(
	'',
	'## Lines by line kind',
	'',
	'Lines counts the lines of each line kind the task holds: the ground truth lines for a find task, the target lines or required lines for an edit task. A line with two line kinds counts under both, so the counts can sum to more than the line total.',
	'',
	'| Task | Codebase version | Line kind | Lines | Mean true positives | Mean changed |',
	'|---|---|---|---|---|---|',
);
for (const task of config.tasks) {
	for (const codebaseVersion of codebaseVersions) {
		lines.push(...lineKindRows(task.id, codebaseVersion, scored.filter(row => row.task === task.id && row.codebaseVersion === codebaseVersion), kinds, task.kind));
	}
}

lines.push('');
fs.writeFileSync(path.join(resultsDir, 'agent-summary.md'), lines.join('\n'));
console.log(lines.join('\n'));
