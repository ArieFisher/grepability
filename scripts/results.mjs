// The results table: each concept's search score and agent score per codebase version, the change between
// codebase versions, and an overall row that leaves out the control concept. Pure functions; the results-table
// script reads the files and writes the table.
import {mean, successScore} from './helpers.mjs';

// The harmonic mean of recall and precision (the F1-score). A recall of 0 gives 0 whatever the precision,
// so a pattern search with no hits scores 0. Any other missing value gives null.
export const searchScore = (recall, precision) => {
	if (recall === 0) {
		return 0;
	}

	if (recall === null || precision === null) {
		return null;
	}

	return (2 * recall * precision) / (recall + precision);
};

// Proposed minus published. A missing side gives null.
const change = (byCodebaseVersion, codebaseVersionNames, read) => {
	const [published, proposed] = codebaseVersionNames.map(codebaseVersion => read(byCodebaseVersion[codebaseVersion]));
	return published === null || proposed === null ? null : proposed - published;
};

const changes = (byCodebaseVersion, codebaseVersionNames) => ({
	searchScore: change(byCodebaseVersion, codebaseVersionNames, cell => cell.searchScore),
	agentScore: change(byCodebaseVersion, codebaseVersionNames, cell => cell.agent?.score ?? null),
});

// Each agent task run gains its concept through its task. An agent task run whose task is not configured throws.
const agentTaskRunsWithConcept = (agentTaskRuns, tasks) => {
	const conceptOf = new Map(tasks.map(task => [task.id, task.concept]));
	return agentTaskRuns.map(agentTaskRun => {
		if (!conceptOf.has(agentTaskRun.task)) {
			throw new Error(`Agent task run ${agentTaskRun.runId ?? ''} names task ${agentTaskRun.task}, which the task configuration does not hold.`);
		}

		return {...agentTaskRun, concept: conceptOf.get(agentTaskRun.task)};
	});
};

const conceptCell = (concept, codebaseVersion, searchResults, agentTaskRuns) => {
	const result = searchResults.find(row => row.version === codebaseVersion && row.concept === concept.id);
	if (!result) {
		throw new Error(`The search score holds no result for concept ${concept.id} in codebase version ${codebaseVersion}; run scripts/search-score.mjs.`);
	}

	return {
		recall: result.recall,
		precision: result.precision,
		searchScore: searchScore(result.recall, result.precision),
		agent: successScore(agentTaskRuns.filter(agentTaskRun => agentTaskRun.version === codebaseVersion && agentTaskRun.concept === concept.id)),
	};
};

// The overall search score is the mean over concepts, so each concept counts once. The overall agent
// score pools every agent task run, so each agent task run counts once. Both leave out the control concept. A
// concept with no search score in a codebase version makes that codebase version's overall search score null, so
// both codebase versions always average the same concepts.
const overallRow = (rows, agentTaskRuns, codebaseVersionNames) => {
	const measured = rows.filter(row => !row.control);
	const ids = new Set(measured.map(row => row.concept));
	const scores = codebaseVersion => measured.map(row => row.byCodebaseVersion[codebaseVersion].searchScore);
	const byCodebaseVersion = Object.fromEntries(codebaseVersionNames.map(codebaseVersion => [codebaseVersion, {
		searchScore: scores(codebaseVersion).includes(null) ? null : mean(scores(codebaseVersion)),
		agent: successScore(agentTaskRuns.filter(agentTaskRun => agentTaskRun.version === codebaseVersion && ids.has(agentTaskRun.concept))),
	}]));
	return {byCodebaseVersion, change: changes(byCodebaseVersion, codebaseVersionNames)};
};

export const resultsTable = ({concepts, tasks, searchResults, agentTaskRuns, codebaseVersionNames}) => {
	const withConcept = agentTaskRunsWithConcept(agentTaskRuns, tasks);
	const rows = concepts.map(concept => {
		const byCodebaseVersion = Object.fromEntries(codebaseVersionNames.map(codebaseVersion => [codebaseVersion, conceptCell(concept, codebaseVersion, searchResults, withConcept)]));
		return {concept: concept.id, name: concept.name, control: Boolean(concept.control), byCodebaseVersion, change: changes(byCodebaseVersion, codebaseVersionNames)};
	});
	return {
		rows,
		overall: overallRow(rows, withConcept, codebaseVersionNames),
		skippedAgentTaskRuns: withConcept.filter(agentTaskRun => agentTaskRun.testsRun === false).length,
		unknownAgentTaskRuns: withConcept.filter(agentTaskRun => agentTaskRun.success === null).length,
	};
};
