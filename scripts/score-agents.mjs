// Scores agent task runs.
//   find tasks: recall of the listed lines against the ground truth.
//   edit tasks: which concept lines (or required lines) the agent changed, which other lines it changed,
//               type checks, edit regressions, and the withheld acceptance test if the task has one.
// Writes work/agent-task-runs/scores.json (no codebase version) and results/blind-edits-review.csv (no codebase
// version column; a person marks wrong edits on it before looking at the key). An existing sheet keeps its rows and
// answers; only new agent task runs are added.
// Next: summarize-agents.mjs joins the scores to the key, after the sheet is answered.
// Without --skip-verification-suite, every agent task run copy and both codebase versions' pre-edit codebase
// verification suite results must be present; a missing one stops the script rather than scoring the agent task
// run on recall alone.
// Usage: node score-agents.mjs [--skip-verification-suite]
import fs from 'node:fs';
import path from 'node:path';
import {agentTaskRunMeasures, blindEditsReviewSheetColumns, blindEditsReviewSheetRows, changedOriginalLines, codebaseVersionDir, codebaseVersions, corpusFiles, editRegressionCandidates, editSuccess, findScore, fromCsv, inCorpus, isNameLine, isWithheldAcceptanceTest, judgeLostVerificationTitles, kindTally, listedLines, loadCodebase, loadConcepts, loadTasks, matchesPublishedSearchPattern, projectRoot, publishedCodebaseVersion, readJson, reexecuteVerification, renamedVerificationTitles, runChecked, splitKey, toCsv, truthLines, withheldAcceptanceTestPath, workDir, writeJson} from './lib.mjs';

const skipVerificationSuite = process.argv.includes('--skip-verification-suite');
const config = loadTasks();
const {concepts} = loadConcepts();
const truth = readJson(path.join(projectRoot, 'truth', 'truth.json'));
const agentTaskRunsDir = path.join(workDir, 'agent-task-runs');
const agentTaskRunKey = readJson(path.join(agentTaskRunsDir, 'key.json'));
const resultsDir = path.join(projectRoot, 'results');
fs.mkdirSync(resultsDir, {recursive: true});

// Files an agent may name in a find reply, each with its line count: the published codebase's corpus
// when present. Without the checkout, every file in the truth, counted up to its highest truth line;
// a range past that line holds no truth line, so clipping it loses nothing.
const publishedRoot = codebaseVersionDir(publishedCodebaseVersion);
const knownFiles = new Map();
if (fs.existsSync(path.join(publishedRoot, loadCodebase().corpus.directory))) {
	for (const file of corpusFiles(publishedRoot)) {
		knownFiles.set(file, fs.readFileSync(path.join(publishedRoot, file), 'utf8').split('\n').length);
	}
} else {
	for (const entry of Object.values(truth.concepts)) {
		for (const line of truthLines(entry)) {
			const {file, line: number} = splitKey(line);
			knownFiles.set(file, Math.max(knownFiles.get(file) ?? 0, number));
		}
	}
}

const preEditResults = Object.fromEntries(codebaseVersions.map(codebaseVersion => {
	const file = path.join(workDir, `pre-edit-results-${codebaseVersion}.json`);
	if (fs.existsSync(file)) {
		return [codebaseVersion, readJson(file)];
	}

	if (!skipVerificationSuite) {
		throw new Error(`Missing pre-edit codebase verification suite results ${file}: run scripts/execute-verification-suite.mjs ${codebaseVersion}, or pass --skip-verification-suite to score recall only.`);
	}

	return [codebaseVersion, {verifications: {}}];
}));

const scored = [];
for (const [agentTaskRunId, {codebaseVersion, task: taskId}] of Object.entries(agentTaskRunKey)) {
	if (!codebaseVersions.includes(codebaseVersion)) {
		throw new Error(`Agent task run ${agentTaskRunId}: the key names codebase version "${codebaseVersion}", expected one of ${codebaseVersions.join(', ')}. An agent task run recorded before the codebase versions were named needs a fresh agent task run.`);
	}

	const agentTaskRunDir = path.join(agentTaskRunsDir, agentTaskRunId);
	const agentTaskRun = readJson(path.join(agentTaskRunDir, 'run.json'));
	const task = config.tasks.find(item => item.id === taskId);
	const concept = concepts.find(item => item.id === task.concept);
	const entry = truth.concepts[task.concept];
	const expected = new Set(truthLines(entry));
	const diff = fs.readFileSync(path.join(agentTaskRunDir, 'diff.patch'), 'utf8');
	const row = {
		agentTaskRunId,
		codebaseVersion,
		task: taskId,
		agentError: agentTaskRun.isError || agentTaskRun.exitCode !== 0 || Boolean(agentTaskRun.agentTaskRunError),
		...agentTaskRunMeasures(agentTaskRun),
	};

	if (task.kind === 'find') {
		const listed = listedLines(fs.readFileSync(path.join(agentTaskRunDir, 'final.md'), 'utf8'), knownFiles);
		Object.assign(row, findScore(listed, expected));
		row.targetLines = expected.size;
		row.byKind = kindTally(truthLines(entry), listed, entry.lines);
	} else {
		const changed = changedOriginalLines(diff);
		const sourceChanged = [...changed].filter(item => inCorpus(item));
		// Lines the agent had to change: the task's required lines, or for a rename task, the concept's lines that
		// name it (a name the type checker found, or wording matching the concept's published search pattern in that
		// codebase version).
		if (!task.requiredLines && !concept.publishedSearchPattern) {
			throw new Error(`Concept ${concept.id} has no "publishedSearchPattern" in config/concepts.json, which task ${task.id} needs to pick its target lines.`);
		}

		const targets = new Set(task.requiredLines ?? [...expected].filter(item => {
			if (isNameLine(entry, item)) {
				return true;
			}

			const {file, line} = splitKey(item);
			return matchesPublishedSearchPattern(fs.readFileSync(path.join(codebaseVersionDir(codebaseVersion), file), 'utf8').split('\n'), line, concept.publishedSearchPattern);
		}));
		if (targets.size === 0) {
			throw new Error(`Task ${task.id} has no target lines in codebase version ${codebaseVersion}.`);
		}

		row.targetLines = targets.size;
		row.byKind = kindTally([...targets], changed, entry.lines);
		row.missed = [...targets].filter(item => !changed.has(item)).length;
		row.otherSourceLinesChanged = sourceChanged.filter(item => !expected.has(item) && !targets.has(item)).length;
		row.recall = (targets.size - row.missed) / targets.size;
		row.verificationSuiteExecuted = !skipVerificationSuite;

		if (!skipVerificationSuite && !fs.existsSync(agentTaskRun.directory)) {
			throw new Error(`Agent task run ${agentTaskRunId}: agent task run copy ${agentTaskRun.directory} is gone, so its codebase verification suite cannot execute. Pass --skip-verification-suite to score recall only.`);
		}

		if (!skipVerificationSuite) {
			// The withheld acceptance test lands in the codebase's verification folder, where the codebase
			// verification suite execution picks it up.
			if (task.withheldAcceptanceTest) {
				fs.copyFileSync(path.join(projectRoot, task.withheldAcceptanceTest), withheldAcceptanceTestPath(agentTaskRun.directory));
			}

			// An old result file is removed first, so a failed codebase verification suite execution cannot be scored
			// from a stale one. Exit status 1 with a fresh file means the type check failed, which is a result; no file
			// means the codebase verification suite execution failed.
			const output = path.join(agentTaskRunDir, 'verification-suite.json');
			fs.rmSync(output, {force: true});
			runChecked('node', [path.join(projectRoot, 'scripts', 'execute-verification-suite.mjs'), agentTaskRun.directory, output], {stdio: 'inherit'});
			if (!fs.existsSync(output)) {
				throw new Error(`Agent task run ${agentTaskRunId}: the codebase verification suite execution wrote no result in ${output}.`);
			}

			const suiteResults = readJson(output);
			// An edit regression is an individual codebase verification that fails every re-execution, under its new
			// title when the diff renamed it, or a removed verification. One that passes a re-execution is a flaky
			// verification. judgeLostVerificationTitles gives each lost verification title one re-execution, up to its
			// limit per verification file, and reports a verification file that stopped partway.
			const {verificationSuite} = loadCodebase();
			const {reexecute, files} = editRegressionCandidates(preEditResults[codebaseVersion].verifications, suiteResults.verifications, renamedVerificationTitles(diff, verificationSuite), verificationSuite.verificationTitleSeparator);
			const stoppedPartway = [];
			const failing = [
				...reexecute.filter(title => reexecuteVerification(agentTaskRun.directory, title) === 0),
				...files.flatMap(({file, lostVerificationTitles}) => {
					const judged = judgeLostVerificationTitles(lostVerificationTitles, title => reexecuteVerification(agentTaskRun.directory, title, 1) === 1);
					if (judged.stoppedPartway) {
						stoppedPartway.push(file);
					}

					return Array.from({length: judged.removedVerifications}, () => `${file} (verification removed)`);
				}),
			];
			row.verificationFilesStoppedPartway = stoppedPartway.join('; ');
			row.typecheck = suiteResults.typecheck;
			row.editRegressions = failing.length;
			row.regressedVerifications = failing.join('; ');
			if (task.withheldAcceptanceTest) {
				const withheld = Object.entries(suiteResults.verifications).filter(([title]) => isWithheldAcceptanceTest(title));
				row.withheldAcceptanceTestPassed = withheld.length > 0 && withheld.every(([, passed]) => passed);
			}

			row.success = editSuccess(row);
		} else {
			row.success = row.missed === 0;
		}
	}

	scored.push(row);
}

// Scores carry no codebase version, so nothing a person opens before the blind edits-review shows one.
// summarize-agents.mjs joins them to the key.
writeJson(path.join(agentTaskRunsDir, 'scores.json'), scored.map(({codebaseVersion, ...score}) => score));

// Blind edits-review sheet: rows already there stay as written, with their answers. New agent task runs follow,
// shuffled, with no codebase version.
const sheetFile = path.join(resultsDir, 'blind-edits-review.csv');
const existingRows = fs.existsSync(sheetFile) ? fromCsv(fs.readFileSync(sheetFile, 'utf8')) : [];
const relativeAgentTaskRunFile = (agentTaskRunId, name) => path.relative(projectRoot, path.join(agentTaskRunsDir, agentTaskRunId, name));
const sheet = blindEditsReviewSheetRows(existingRows, scored.map(row => ({agentTaskRunId: row.agentTaskRunId, task: row.task, diff: relativeAgentTaskRunFile(row.agentTaskRunId, 'diff.patch'), finalReply: relativeAgentTaskRunFile(row.agentTaskRunId, 'final.md')})));
fs.writeFileSync(sheetFile, toCsv([blindEditsReviewSheetColumns, ...sheet]));
console.log(`Wrote ${path.relative(projectRoot, sheetFile)} (${sheet.length} agent task runs). Fill wrong_edits with yes or no on each row, then run node scripts/summarize-agents.mjs.`);
