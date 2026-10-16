// One-off migration of the local, untracked files the scripts read, from the names before the vocabulary rename to
// the names after it: file and folder names, JSON fields, one CSV column, and the agent task run folder paths that
// run.json, the verification suite result files, and the blind edits-review sheet hold. Each clone runs it once,
// from the commit that adds it, before any other script of that commit.
// The script plans every change first and stops with an error, before it changes anything, when a source is missing,
// a destination exists, or a file lacks a field it renames. With --dry-run it prints the plan and changes nothing.
// It walks the agent task runs once, bounded by the entries in the key.
// Usage: node scripts/migrate-local-data.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import {codebaseVersions, fromCsv, loadCodebase, projectRoot, readJson, toCsv, workDir} from './lib.mjs';

const dryRun = process.argv.includes('--dry-run');
const truthDir = path.join(projectRoot, 'truth');
const resultsDir = path.join(projectRoot, 'results');
const oldAgentTaskRunsDir = path.join(workDir, 'runs');
const newAgentTaskRunsDir = path.join(workDir, 'agent-task-runs');
const relativeOf = file => path.relative(projectRoot, file);

const rewrites = [];
const innerMoves = [];
const outerMoves = [];
const errors = [];

const requireSource = file => {
	if (!fs.existsSync(file)) {
		errors.push(`Missing source ${relativeOf(file)}.`);
		return false;
	}

	return true;
};

const requireNoDestination = file => {
	if (fs.existsSync(file)) {
		errors.push(`Destination ${relativeOf(file)} exists.`);
		return false;
	}

	return true;
};

const planMove = (list, from, to, {optional = false} = {}) => {
	if (optional && !fs.existsSync(from)) {
		return;
	}

	if (requireSource(from) && requireNoDestination(to)) {
		list.push({from, to});
	}
};

// The same object with each key in `renames` replaced by its new name, in place in the key order. A required key
// that is missing, or a new key that already exists, is an error.
const renameKeys = (object, renames, where, required = Object.keys(renames)) => {
	for (const [oldKey, newKey] of Object.entries(renames)) {
		if (Object.hasOwn(object, newKey)) {
			errors.push(`${where} already holds the field ${newKey}.`);
		}

		if (required.includes(oldKey) && !Object.hasOwn(object, oldKey)) {
			errors.push(`${where} lacks the field ${oldKey}.`);
		}
	}

	return Object.fromEntries(Object.entries(object).map(([name, value]) => [renames[name] ?? name, value]));
};

// An agent task run folder path under work/runs, moved under work/agent-task-runs. A path elsewhere is an error.
const movedAgentTaskRunPath = (value, where) => {
	if (typeof value !== 'string' || !value.startsWith(`${oldAgentTaskRunsDir}${path.sep}`)) {
		errors.push(`${where} holds the path ${value}, which is not under ${relativeOf(oldAgentTaskRunsDir)}.`);
		return value;
	}

	return path.join(newAgentTaskRunsDir, path.relative(oldAgentTaskRunsDir, value));
};

const planJsonRewrite = (file, transform) => {
	if (requireSource(file)) {
		rewrites.push({file, text: JSON.stringify(transform(readJson(file)), null, '\t') + '\n'});
	}
};

// The tagging sheet, the tagger files, and the ground truth's list of taggers.
planMove(outerMoves, path.join(truthDir, 'review-sheet.csv'), path.join(truthDir, 'tagging-sheet.csv'));
const reviewerFiles = fs.existsSync(truthDir) ? fs.readdirSync(truthDir).filter(file => /^reviewer-.+\.csv$/.test(file)) : [];
if (reviewerFiles.length === 0) {
	errors.push('Missing source truth/reviewer-*.csv.');
}

for (const file of reviewerFiles) {
	planMove(outerMoves, path.join(truthDir, file), path.join(truthDir, file.replace(/^reviewer-/, 'tagger-')));
}

planJsonRewrite(path.join(truthDir, 'truth.json'), truth => renameKeys(truth, {reviewers: 'taggers'}, 'truth/truth.json'));

// The pre-edit codebase verification suite results of each codebase version.
for (const codebaseVersion of codebaseVersions) {
	const from = path.join(workDir, `tests-${codebaseVersion}.json`);
	planJsonRewrite(from, results => renameKeys(results, {tests: 'verifications'}, relativeOf(from)));
	planMove(outerMoves, from, path.join(workDir, `pre-edit-results-${codebaseVersion}.json`));
}

// The agent task runs: the key, the scores, the fired cloud agent task runs, and each agent task run's folder.
const keyFile = path.join(oldAgentTaskRunsDir, 'key.json');
planJsonRewrite(keyFile, key => Object.fromEntries(Object.entries(key).map(([agentTaskRunId, entry]) => [agentTaskRunId, renameKeys(entry, {version: 'codebaseVersion'}, `work/runs/key.json entry ${agentTaskRunId}`)])));
const firedFile = path.join(oldAgentTaskRunsDir, 'cloud-fired.json');
if (fs.existsSync(firedFile)) {
	planJsonRewrite(firedFile, fired => Object.fromEntries(Object.entries(fired).map(([agentTaskRunId, entry]) => [agentTaskRunId, renameKeys(entry, {version: 'codebaseVersion'}, `work/runs/cloud-fired.json entry ${agentTaskRunId}`)])));
}

const scoreRenames = {
	runId: 'agentTaskRunId',
	testsRun: 'verificationSuiteExecuted',
	testRegressions: 'editRegressions',
	regressedTests: 'regressedVerifications',
	hiddenTestPassed: 'withheldAcceptanceTestPassed',
	testFilesStoppedPartway: 'verificationFilesStoppedPartway',
	searchCalls: 'agentSearchToolCalls',
};
planJsonRewrite(path.join(oldAgentTaskRunsDir, 'scores.json'), scores => scores.map(row => {
	const renamed = renameKeys(row, scoreRenames, `work/runs/scores.json row ${row.runId}`, ['runId', 'searchCalls']);
	return typeof renamed.regressedVerifications === 'string'
		? {...renamed, regressedVerifications: renamed.regressedVerifications.replaceAll('(test removed)', '(verification removed)')}
		: renamed;
}));

const {verificationSuite} = loadCodebase();
const key = fs.existsSync(keyFile) ? readJson(keyFile) : {};
for (const agentTaskRunId of Object.keys(key)) {
	const agentTaskRunDir = path.join(oldAgentTaskRunsDir, agentTaskRunId);
	const runFile = path.join(agentTaskRunDir, 'run.json');
	if (!requireSource(runFile)) {
		continue;
	}

	const where = `work/runs/${agentTaskRunId}/run.json`;
	const agentTaskRun = readJson(runFile);
	const renamed = renameKeys(agentTaskRun, {runId: 'agentTaskRunId', runError: 'agentTaskRunError'}, where, ['runId']);
	rewrites.push({file: runFile, text: JSON.stringify({...renamed, directory: movedAgentTaskRunPath(agentTaskRun.directory, where)}, null, '\t') + '\n'});

	// A scored agent task run of an edit task holds its codebase verification suite results.
	const suiteFile = path.join(agentTaskRunDir, 'tests.json');
	if (fs.existsSync(suiteFile)) {
		const suiteWhere = `work/runs/${agentTaskRunId}/tests.json`;
		planJsonRewrite(suiteFile, results => ({...renameKeys(results, {tests: 'verifications'}, suiteWhere), directory: movedAgentTaskRunPath(results.directory, suiteWhere)}));
		planMove(innerMoves, suiteFile, path.join(agentTaskRunDir, 'verification-suite.json'));
	}

	// The withheld acceptance test that an earlier scoring copied into the agent task run copy.
	const verificationFolder = path.join(agentTaskRun.directory ?? '', verificationSuite.directory);
	planMove(innerMoves, path.join(verificationFolder, `hidden-acceptance${verificationSuite.extension}`), path.join(verificationFolder, `withheld-acceptance${verificationSuite.extension}`), {optional: true});
}

planMove(outerMoves, oldAgentTaskRunsDir, newAgentTaskRunsDir);
planMove(outerMoves, path.join(workDir, 'run-slots'), path.join(workDir, 'agent-task-run-slots'), {optional: true});
planMove(outerMoves, path.join(projectRoot, 'hidden-tests'), path.join(projectRoot, 'withheld-acceptance-tests'));

// The blind edits-review sheet: the agent task run id column and the agent task run file paths.
const oldSheet = path.join(resultsDir, 'blind-review.csv');
if (requireSource(oldSheet)) {
	const text = fs.readFileSync(oldSheet, 'utf8');
	const header = text.split('\n')[0].replace(/\r$/, '').split(',');
	if (!header.includes('runId') || header.includes('agentTaskRunId')) {
		errors.push('results/blind-review.csv: the header lacks runId or already holds agentTaskRunId.');
	}

	const oldPrefix = `${relativeOf(oldAgentTaskRunsDir)}/`;
	const newPrefix = `${relativeOf(newAgentTaskRunsDir)}/`;
	const movedCell = value => value.startsWith(oldPrefix) ? newPrefix + value.slice(oldPrefix.length) : value;
	const rows = fromCsv(text).map(row => header.map(column => ['diff', 'final_reply'].includes(column) ? movedCell(row[column]) : row[column]));
	rewrites.push({file: oldSheet, text: toCsv([header.map(column => column === 'runId' ? 'agentTaskRunId' : column), ...rows])});
	planMove(outerMoves, oldSheet, path.join(resultsDir, 'blind-edits-review.csv'));
}

if (errors.length > 0) {
	console.error(`Nothing changed.\n${[...new Set(errors)].join('\n')}`);
	process.exit(1);
}

for (const {file} of rewrites) {
	console.log(`rewrite ${relativeOf(file)}`);
}

for (const {from, to} of [...innerMoves, ...outerMoves]) {
	console.log(`move ${relativeOf(from)} -> ${relativeOf(to)}`);
}

if (dryRun) {
	console.log('Dry run: nothing changed.');
	process.exit(0);
}

// Rewrites happen at the old paths, then the files and folders inside the agent task runs folder move, then the
// folders that hold them.
for (const {file, text} of rewrites) {
	fs.writeFileSync(file, text);
}

for (const {from, to} of [...innerMoves, ...outerMoves]) {
	fs.renameSync(from, to);
}

console.log(`Migrated: ${rewrites.length} rewrites, ${innerMoves.length + outerMoves.length} moves.`);
