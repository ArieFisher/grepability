// The results table: each concept's search score and agent score per version, the change between
// versions, and an overall row that leaves out the control concept. Pure functions; the results-table
// script reads the files and writes the table.
import {wilson} from './helpers.mjs';

// The harmonic mean of find rate and term distinctiveness. A missing value gives null; both at 0 give 0.
export const searchScore = (findRate, termDistinctiveness) => {
	if (findRate === null || termDistinctiveness === null) {
		return null;
	}

	const sum = findRate + termDistinctiveness;
	return sum === 0 ? 0 : (2 * findRate * termDistinctiveness) / sum;
};

// Success rate over a list of runs, with the Wilson interval beside it. No runs give null.
const agentScore = runs => {
	if (runs.length === 0) {
		return null;
	}

	const successes = runs.filter(run => run.success).length;
	return {successes, runs: runs.length, score: successes / runs.length, interval: wilson(successes, runs.length)};
};

const mean = values => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

// Proposed minus published. A missing side gives null.
const change = (byVersion, versionNames, read) => {
	const [published, proposed] = versionNames.map(version => read(byVersion[version]));
	return published === null || proposed === null ? null : proposed - published;
};

const changes = (byVersion, versionNames) => ({
	searchScore: change(byVersion, versionNames, cell => cell.searchScore),
	agentScore: change(byVersion, versionNames, cell => cell.agent?.score ?? null),
});

// Each agent run gains its concept through its task. A run whose task is not configured throws.
const runsWithConcept = (agentRuns, tasks) => {
	const conceptOf = new Map(tasks.map(task => [task.id, task.concept]));
	return agentRuns.map(run => {
		if (!conceptOf.has(run.task)) {
			throw new Error(`Run ${run.runId ?? ''} names task ${run.task}, which the task configuration does not hold.`);
		}

		return {...run, concept: conceptOf.get(run.task)};
	});
};

const conceptCell = (concept, version, searchResults, runs) => {
	const result = searchResults.find(row => row.version === version && row.concept === concept.id);
	if (!result) {
		throw new Error(`The search score holds no result for concept ${concept.id} in version ${version}; run scripts/search-score.mjs.`);
	}

	return {
		findRate: result.findRate,
		termDistinctiveness: result.termDistinctiveness,
		searchScore: searchScore(result.findRate, result.termDistinctiveness),
		agent: agentScore(runs.filter(run => run.version === version && run.concept === concept.id)),
	};
};

// The overall search score is the mean over concepts, so each concept counts once. The overall agent
// score pools every run, so each run counts once. Both leave out the control concept.
const overallRow = (rows, runs, versionNames) => {
	const measured = rows.filter(row => !row.control);
	const ids = new Set(measured.map(row => row.concept));
	const scores = version => measured.map(row => row.byVersion[version].searchScore).filter(value => value !== null);
	const byVersion = Object.fromEntries(versionNames.map(version => [version, {
		searchScore: mean(scores(version)),
		agent: agentScore(runs.filter(run => run.version === version && ids.has(run.concept))),
	}]));
	return {byVersion, change: changes(byVersion, versionNames)};
};

export const resultsTable = ({concepts, tasks, searchResults, agentRuns, versionNames}) => {
	const runs = runsWithConcept(agentRuns, tasks);
	const rows = concepts.map(concept => {
		const byVersion = Object.fromEntries(versionNames.map(version => [version, conceptCell(concept, version, searchResults, runs)]));
		return {concept: concept.id, name: concept.name, control: Boolean(concept.control), byVersion, change: changes(byVersion, versionNames)};
	});
	return {rows, overall: overallRow(rows, runs, versionNames)};
};
