// Cloud runs, step 3: collects the fired runs that have pushed a run branch. For each one the script builds
// a run copy of the version, applies the branch's changes to it, and writes the same files as run-agents.mjs
// (diff.patch, final.md, run.json) and a key entry, so score-agents.mjs scores it like a local run.
// A run that has pushed nothing stays pending until the pending limit in config/tasks.json passes, then
// counts as a failed run with no changes. Cost, time, turns, and tool counts of a cloud run are unknown (null).
// Usage: node collect-runs.mjs
import fs from 'node:fs';
import path from 'node:path';
import {applyDiff, fetchRunBranches, loadCloud, loadRoutines, readRunBranch} from './cloud.mjs';
import {diffSinceSnapshot, loadCodebase, loadTasks, makeRunCopy, readJson, versionDir, workDir, writeJson} from './lib.mjs';

const config = loadTasks();
const cloud = loadCloud();
const runsDir = path.join(workDir, 'runs');
const keyFile = path.join(runsDir, 'key.json');
const firedFile = path.join(runsDir, 'cloud-fired.json');
if (!fs.existsSync(firedFile)) {
	throw new Error(`Missing ${firedFile}: fire runs first with node scripts/fire-routines.mjs.`);
}

const fired = readJson(firedFile);
const key = fs.existsSync(keyFile) ? readJson(keyFile) : {};
const pending = Object.entries(fired).filter(([runId]) => !key[runId]);
if (pending.length === 0) {
	console.log('Nothing to collect.');
	process.exit(0);
}

const {repositories} = loadRoutines([]);
const cacheOf = version => path.join(workDir, 'cloud', `${version}.git`);
for (const version of new Set(pending.map(([, entry]) => entry.version))) {
	fetchRunBranches(cacheOf(version), repositories[version]);
}

const copyName = path.basename(loadCodebase().repository, '.git');
const pendingLimitMs = cloud.pendingLimitMinutes * 60_000;
let collected = 0;
let waiting = 0;
for (const [runId, entry] of pending) {
	const task = config.tasks.find(item => item.id === entry.task);
	const branch = readRunBranch(cacheOf(entry.version), cloud, runId);
	const ageMs = Date.now() - Date.parse(entry.firedAt);
	if (!branch && ageMs < pendingLimitMs) {
		waiting++;
		console.log(`${runId}: ${entry.task} has pushed nothing yet (${Math.round(ageMs / 60_000)} minutes).`);
		continue;
	}

	const runDir = path.join(runsDir, runId);
	fs.mkdirSync(runDir, {recursive: true});
	const {directory, snapshot} = makeRunCopy(versionDir(entry.version), path.join(runDir, copyName));
	const errors = [];
	if (branch) {
		applyDiff(directory, branch.diff);
		// A find task is scored on its reply, so a missing reply file makes the run an error.
		if (branch.reply === null && task.kind === 'find') {
			errors.push(`the run branch holds no ${cloud.replyFile}`);
		}
	} else {
		errors.push(`no run branch after ${cloud.pendingLimitMinutes} minutes`);
	}

	fs.writeFileSync(path.join(runDir, 'diff.patch'), diffSinceSnapshot(directory, snapshot));
	fs.writeFileSync(path.join(runDir, 'final.md'), branch?.reply ?? '');
	writeJson(path.join(runDir, 'run.json'), {
		runId, task: entry.task, directory, snapshot, cloud: true, sessionId: entry.sessionId, sessionUrl: entry.sessionUrl,
		model: null, exitCode: 0, wallMs: null, durationMs: null, costUsd: null, turns: null, toolCounts: null, isError: false,
		runError: errors.join('; ') || undefined,
	});
	key[runId] = {version: entry.version, task: entry.task, index: entry.index};
	writeJson(keyFile, key);
	collected++;
	console.log(`${runId}: ${entry.task} collected${errors.length > 0 ? `, ${errors.join('; ')}` : ''}.`);
}

console.log(`${collected} collected, ${waiting} still pending.${waiting > 0 ? ' Run the script again later.' : ' Next: node scripts/score-agents.mjs'}`);
