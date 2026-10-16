// Cloud agent task runs, step 3: collects the fired cloud agent task runs that have pushed a cloud agent task run
// branch. For each one the script builds an agent task run copy of the codebase version, applies the branch's
// changes to it, and writes the same files as start-agent-task-runs.mjs (diff.patch, final.md with the reply file's
// text, run.json) and a key entry, so score-agents.mjs scores it like a local agent task run.
// A cloud agent task run that has pushed nothing stays pending until the pending limit in config/tasks.json passes,
// then counts as a failed agent task run with no changes. Cost, time, turns, and tool counts of a cloud agent task
// run are unknown (null).
// Usage: node collect-cloud-agent-task-runs.mjs
import fs from 'node:fs';
import path from 'node:path';
import {applyDiff, fetchCloudAgentTaskRunBranches, loadCloud, loadRoutines, readCloudAgentTaskRunBranch} from './cloud.mjs';
import {codebaseVersionDir, diffSinceSnapshot, loadCodebase, loadTasks, makeAgentTaskRunCopy, readJson, workDir, writeJson} from './lib.mjs';

const config = loadTasks();
const cloud = loadCloud();
const agentTaskRunsDir = path.join(workDir, 'agent-task-runs');
const keyFile = path.join(agentTaskRunsDir, 'key.json');
const firedFile = path.join(agentTaskRunsDir, 'cloud-fired.json');
if (!fs.existsSync(firedFile)) {
	throw new Error(`Missing ${firedFile}: fire cloud agent task runs first with node scripts/fire-routines.mjs.`);
}

const fired = readJson(firedFile);
const key = fs.existsSync(keyFile) ? readJson(keyFile) : {};
const pending = Object.entries(fired).filter(([agentTaskRunId]) => !key[agentTaskRunId]);
if (pending.length === 0) {
	console.log('Nothing to collect.');
	process.exit(0);
}

const {repositories} = loadRoutines([]);
const cacheOf = codebaseVersion => path.join(workDir, 'cloud', `${codebaseVersion}.git`);
for (const codebaseVersion of new Set(pending.map(([, entry]) => entry.codebaseVersion))) {
	fetchCloudAgentTaskRunBranches(cacheOf(codebaseVersion), repositories[codebaseVersion]);
}

const agentTaskRunCopyName = path.basename(loadCodebase().repository, '.git');
const pendingLimitMs = cloud.pendingLimitMinutes * 60_000;
let collected = 0;
let waiting = 0;
for (const [agentTaskRunId, entry] of pending) {
	const task = config.tasks.find(item => item.id === entry.task);
	const branch = readCloudAgentTaskRunBranch(cacheOf(entry.codebaseVersion), cloud, agentTaskRunId);
	const ageMs = Date.now() - Date.parse(entry.firedAt);
	if (!branch && ageMs < pendingLimitMs) {
		waiting++;
		console.log(`${agentTaskRunId}: ${entry.task} has pushed nothing yet (${Math.round(ageMs / 60_000)} minutes).`);
		continue;
	}

	const agentTaskRunDir = path.join(agentTaskRunsDir, agentTaskRunId);
	fs.mkdirSync(agentTaskRunDir, {recursive: true});
	const {directory, snapshot} = makeAgentTaskRunCopy(codebaseVersionDir(entry.codebaseVersion), path.join(agentTaskRunDir, agentTaskRunCopyName));
	const errors = [];
	if (branch) {
		applyDiff(directory, branch.diff);
		// A find task is scored on its reply, so a missing reply file makes the agent task run an error.
		if (branch.reply === null && task.kind === 'find') {
			errors.push(`the cloud agent task run branch holds no ${cloud.replyFile}`);
		}
	} else {
		errors.push(`no cloud agent task run branch after ${cloud.pendingLimitMinutes} minutes`);
	}

	fs.writeFileSync(path.join(agentTaskRunDir, 'diff.patch'), diffSinceSnapshot(directory, snapshot));
	fs.writeFileSync(path.join(agentTaskRunDir, 'final.md'), branch?.reply ?? '');
	writeJson(path.join(agentTaskRunDir, 'run.json'), {
		agentTaskRunId, task: entry.task, directory, snapshot, cloud: true, sessionId: entry.sessionId, sessionUrl: entry.sessionUrl,
		model: null, exitCode: 0, wallMs: null, durationMs: null, costUsd: null, turns: null, toolCounts: null, isError: false,
		agentTaskRunError: errors.join('; ') || undefined,
	});
	key[agentTaskRunId] = {codebaseVersion: entry.codebaseVersion, task: entry.task, index: entry.index};
	writeJson(keyFile, key);
	collected++;
	console.log(`${agentTaskRunId}: ${entry.task} collected${errors.length > 0 ? `, ${errors.join('; ')}` : ''}.`);
}

console.log(`${collected} collected, ${waiting} still pending.${waiting > 0 ? ' Run the script again later.' : ' Next: node scripts/score-agents.mjs'}`);
