// Results table: each concept's search score and agent score per version, with the change between versions
// and an overall row that leaves out the control concept.
// Reads results/search-score.json (from search-score.mjs), which holds the ground truth state its scores used,
// and results/agent-runs.json (from summarize-agents.mjs).
// Without agent runs the script writes n/a for every agent score and a note above the table.
// Writes results/results-table.md.
// Usage: node results-table.mjs
import fs from 'node:fs';
import path from 'node:path';
import {loadConcepts, loadTasks, percent, projectRoot, readJson, truthStatement, versions} from './lib.mjs';
import {resultsTable} from './results.mjs';

const resultsDir = path.join(projectRoot, 'results');
const searchFile = path.join(resultsDir, 'search-score.json');
const agentFile = path.join(resultsDir, 'agent-runs.json');
if (!fs.existsSync(searchFile)) {
	throw new Error(`Missing ${searchFile}: run scripts/search-score.mjs first.`);
}

const search = readJson(searchFile);
const agentRuns = fs.existsSync(agentFile) ? readJson(agentFile) : [];
const table = resultsTable({
	concepts: loadConcepts().concepts,
	tasks: loadTasks().tasks,
	searchResults: search.results,
	agentRuns,
	versionNames: versions,
});

const points = value => value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${Math.round(value * 100)} points`;
const agentCell = agent => agent === null ? 'n/a' : `${percent(agent.score)} (${agent.successes}/${agent.runs}, ${percent(agent.interval.low)} to ${percent(agent.interval.high)})`;
const scoreCells = ({byVersion, change}) => [
	...versions.map(version => percent(byVersion[version].searchScore)),
	points(change.searchScore),
	...versions.map(version => agentCell(byVersion[version].agent)),
	points(change.agentScore),
];

const header = [
	'Concept',
	...versions.map(version => `Search score ${version}`),
	'Search score change',
	...versions.map(version => `Agent score ${version}`),
	'Agent score change',
	...versions.map(version => `Find rate ${version}`),
	...versions.map(version => `Term distinctiveness ${version}`),
];
const conceptLine = row => [
	row.name,
	...scoreCells(row),
	...versions.map(version => percent(row.byVersion[version].findRate)),
	...versions.map(version => percent(row.byVersion[version].termDistinctiveness)),
];
const overallLine = ['**Overall**', ...scoreCells(table.overall), ...versions.flatMap(() => ['', ''])];
const notes = [
	truthStatement(search.truth),
	...(agentRuns.length === 0 ? ['No agent runs are summarized yet, so every agent score shows n/a: run scripts/summarize-agents.mjs.'] : []),
	...(table.skippedRuns > 0 ? [`${table.skippedRuns} edit runs were scored without the type check, the tests, or the hidden test (--skip-tests), and count as successes when they missed no line.`] : []),
	...(table.unknownRuns > 0 ? [`${table.unknownRuns} edit runs had a test file that stopped partway during scoring, so their success is unknown. This script leaves them out of the agent scores; rescore them.`] : []),
];
const markdown = [
	'# Results',
	'',
	notes.join('\n\n'),
	'',
	'Every column and the overall row follow the definitions in docs/vocabulary.md. An agent score shows the success count and its Wilson 95% interval in parentheses. A concept with no task shows n/a for its agent score.',
	'',
	`| ${header.join(' | ')} |`,
	`|${'---|'.repeat(header.length)}`,
	...table.rows.map(row => `| ${conceptLine(row).join(' | ')} |`),
	`| ${overallLine.join(' | ')} |`,
	'',
].join('\n');
fs.writeFileSync(path.join(resultsDir, 'results-table.md'), markdown);
console.log(markdown);
