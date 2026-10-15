// The results table: each concept's search score and agent score per version, the change between
// versions, and an overall row that leaves out the control concept. Pure functions; the results-table
// script reads the files and writes the table.
import {mean, successScore} from './helpers.mjs';

// The harmonic mean of find rate and term distinctiveness. A find rate of 0 gives 0 whatever the term
// distinctiveness, so a search with no hits scores 0. Any other missing value gives null.
export const searchScore = (findRate, termDistinctiveness) => {
	if (findRate === 0) {
		return 0;
	}

	if (findRate === null || termDistinctiveness === null) {
		return null;
	}

	return (2 * findRate * termDistinctiveness) / (findRate + termDistinctiveness);
};

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
		agent: successScore(runs.filter(run => run.version === version && run.concept === concept.id)),
	};
};

// The overall search score is the mean over concepts, so each concept counts once. The overall agent
// score pools every run, so each run counts once. Both leave out the control concept. A concept with no
// search score in a version makes that version's overall search score null, so both versions always
// average the same concepts.
const overallRow = (rows, runs, versionNames) => {
	const measured = rows.filter(row => !row.control);
	const ids = new Set(measured.map(row => row.concept));
	const scores = version => measured.map(row => row.byVersion[version].searchScore);
	const byVersion = Object.fromEntries(versionNames.map(version => [version, {
		searchScore: scores(version).includes(null) ? null : mean(scores(version)),
		agent: successScore(runs.filter(run => run.version === version && ids.has(run.concept))),
	}]));
	return {byVersion, change: changes(byVersion, versionNames)};
};

export const resultsTable = ({concepts, tasks, searchResults, agentRuns, versionNames}) => {
	const runs = runsWithConcept(agentRuns, tasks);
	const rows = concepts.map(concept => {
		const byVersion = Object.fromEntries(versionNames.map(version => [version, conceptCell(concept, version, searchResults, runs)]));
		return {concept: concept.id, name: concept.name, control: Boolean(concept.control), byVersion, change: changes(byVersion, versionNames)};
	});
	return {rows, overall: overallRow(rows, runs, versionNames), skippedRuns: runs.filter(run => run.testsRun === false).length};
};
