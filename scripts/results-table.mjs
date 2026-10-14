// Results table: each concept's search score and agent score per version, with the change between versions
// and an overall row that leaves out the control concept.
// Reads results/search-score.json (from search-score.mjs) and results/agent-runs.json (from summarize-agents.mjs).
// Without agent runs the agent scores show n/a and the table says so.
// Writes results/results-table.md.
// Usage: node results-table.mjs
import fs from 'node:fs';
import path from 'node:path';
import {loadConcepts, loadTasks, percent, projectRoot, readJson, versions} from './lib.mjs';
import {resultsTable} from './results.mjs';

const resultsDir = path.join(projectRoot, 'results');
const searchFile = path.join(resultsDir, 'search-score.json');
const agentFile = path.join(resultsDir, 'agent-runs.json');
if (!fs.existsSync(searchFile)) {
	throw new Error(`Missing ${searchFile}: run scripts/search-score.mjs first.`);
}

const search = readJson(searchFile);
const hasAgentRuns = fs.existsSync(agentFile);
const table = resultsTable({
	concepts: loadConcepts().concepts,
	tasks: loadTasks().tasks,
	searchResults: search.results,
	agentRuns: hasAgentRuns ? readJson(agentFile) : [],
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
const markdown = [
	'# Results',
	'',
	search.provisionalTruth ? 'Ground truth is provisional.' : 'Ground truth is final.',
	hasAgentRuns ? '' : 'No agent runs are summarized yet, so every agent score shows n/a: run scripts/summarize-agents.mjs.',
	'',
	'Search score is the harmonic mean of find rate and term distinctiveness. Agent score is the success rate over the runs of every task on the concept, with the count and its Wilson 95% interval in brackets. A concept with no task shows n/a. Change is proposed minus published. The overall row leaves out the control concept: its search score is the mean over concepts, and its agent score pools every run.',
	'',
	`| ${header.join(' | ')} |`,
	`|${'---|'.repeat(header.length)}`,
	...table.rows.map(row => `| ${conceptLine(row).join(' | ')} |`),
	`| ${overallLine.join(' | ')} |`,
	'',
].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
fs.writeFileSync(path.join(resultsDir, 'results-table.md'), markdown);
console.log(markdown);
