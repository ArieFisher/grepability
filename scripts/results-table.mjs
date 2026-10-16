// Results table: each concept's search score and agent score per codebase version, with the change between
// codebase versions and an overall row that leaves out the control concept.
// Reads results/search-score.json (from search-score.mjs), which holds the ground truth state its scores used,
// and results/agent-runs.json (from summarize-agents.mjs).
// Without agent task runs the script writes n/a for every agent score and a note above the table.
// Writes results/results-table.md.
// Usage: node results-table.mjs
import fs from 'node:fs';
import path from 'node:path';
import {codebaseVersions, loadConcepts, loadTasks, percent, projectRoot, readJson, truthStatement} from './lib.mjs';
import {resultsTable} from './results.mjs';

const resultsDir = path.join(projectRoot, 'results');
const searchFile = path.join(resultsDir, 'search-score.json');
const agentFile = path.join(resultsDir, 'agent-runs.json');
if (!fs.existsSync(searchFile)) {
	throw new Error(`Missing ${searchFile}: run scripts/search-score.mjs first.`);
}

const search = readJson(searchFile);
const agentTaskRuns = fs.existsSync(agentFile) ? readJson(agentFile) : [];
const table = resultsTable({
	concepts: loadConcepts().concepts,
	tasks: loadTasks().tasks,
	searchResults: search.results,
	agentTaskRuns,
	codebaseVersionNames: codebaseVersions,
});

const points = value => value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${Math.round(value * 100)} points`;
const agentCell = agent => agent === null ? 'n/a' : `${percent(agent.score)} (${agent.successes}/${agent.agentTaskRuns}, ${percent(agent.interval.low)} to ${percent(agent.interval.high)})`;
const scoreCells = ({byCodebaseVersion, change}) => [
	...codebaseVersions.map(codebaseVersion => percent(byCodebaseVersion[codebaseVersion].searchScore)),
	points(change.searchScore),
	...codebaseVersions.map(codebaseVersion => agentCell(byCodebaseVersion[codebaseVersion].agent)),
	points(change.agentScore),
];

const header = [
	'Concept',
	...codebaseVersions.map(codebaseVersion => `Search score ${codebaseVersion}`),
	'Search score change',
	...codebaseVersions.map(codebaseVersion => `Agent score ${codebaseVersion}`),
	'Agent score change',
	...codebaseVersions.map(codebaseVersion => `Recall ${codebaseVersion}`),
	...codebaseVersions.map(codebaseVersion => `Precision ${codebaseVersion}`),
];
const conceptLine = row => [
	row.name,
	...scoreCells(row),
	...codebaseVersions.map(codebaseVersion => percent(row.byCodebaseVersion[codebaseVersion].recall)),
	...codebaseVersions.map(codebaseVersion => percent(row.byCodebaseVersion[codebaseVersion].precision)),
];
const overallLine = ['**Overall**', ...scoreCells(table.overall), ...codebaseVersions.flatMap(() => ['', ''])];
const notes = [
	truthStatement(search.truth),
	...(agentTaskRuns.length === 0 ? ['No agent task runs are summarized yet, so every agent score shows n/a: run scripts/summarize-agents.mjs.'] : []),
	...(table.skippedAgentTaskRuns > 0 ? [`${table.skippedAgentTaskRuns} agent task runs of edit tasks were scored without the type check, the codebase verification suite, or the withheld acceptance test (--skip-verification-suite), and count as successes when they missed no line.`] : []),
	...(table.unknownAgentTaskRuns > 0 ? [`${table.unknownAgentTaskRuns} agent task runs of edit tasks had a verification file that stopped partway during scoring, so their success is unknown. This script leaves them out of the agent scores; rescore them.`] : []),
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
