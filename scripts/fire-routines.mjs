// Cloud agent task runs, step 2: fires each routine for the cloud agent task runs its cell still needs. One fire
// starts one cloud agent task run; the request returns at once with the session, and the agent works in the cloud.
// The script records each fired cloud agent task run in work/agent-task-runs/cloud-fired.json with its codebase version and
// task, so collect-cloud-agent-task-runs.mjs can score it once it has pushed.
// The script stops at the first error, including the hourly limit (30 fires per routine, 100 per account).
// Usage: node fire-routines.mjs [--agent-task-runs 10] [--tasks find-all,rename,retry-count-start] [--codebase-versions published,proposed]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {cellKey, fireRoutine, FireError, loadRoutines} from './cloud.mjs';
import {codebaseVersions, integerOption, interleave, loadTasks, missingAgentTaskRuns, option, readJson, workDir, writeJson} from './lib.mjs';

const argv = process.argv.slice(2);
const config = loadTasks();
const agentTaskRunsPerCell = integerOption(argv, 'agent-task-runs', 10, 1);
const taskIds = option(argv, 'tasks', config.tasks.map(task => task.id).join(',')).split(',');
const selectedCodebaseVersions = option(argv, 'codebase-versions', codebaseVersions.join(',')).split(',');
const selectedTasks = taskIds.map(taskId => {
	const task = config.tasks.find(item => item.id === taskId);
	if (!task) {
		throw new Error(`Unknown task ${taskId}`);
	}

	return task;
});
for (const codebaseVersion of selectedCodebaseVersions) {
	if (!codebaseVersions.includes(codebaseVersion)) {
		throw new Error(`Unknown codebase version ${codebaseVersion}, expected one of ${codebaseVersions.join(', ')}`);
	}
}

const agentTaskRunsDir = path.join(workDir, 'agent-task-runs');
const keyFile = path.join(agentTaskRunsDir, 'key.json');
const firedFile = path.join(agentTaskRunsDir, 'cloud-fired.json');
const key = fs.existsSync(keyFile) ? readJson(keyFile) : {};
const fired = fs.existsSync(firedFile) ? readJson(firedFile) : {};
const {routines} = loadRoutines(selectedTasks.flatMap(task => selectedCodebaseVersions.map(codebaseVersion => cellKey(task.id, codebaseVersion))));

// A fired cloud agent task run counts toward its cell until it is collected, and a collected one sits in the key,
// so an agent task run in both counts once.
const allAgentTaskRuns = {...fired, ...key};
const jobs = missingAgentTaskRuns(selectedTasks, selectedCodebaseVersions, agentTaskRunsPerCell, (task, codebaseVersion) => Object.values(allAgentTaskRuns).filter(entry => entry.task === task.id && entry.codebaseVersion === codebaseVersion).length);
const queue = interleave(jobs, job => cellKey(job.task.id, job.codebaseVersion));
console.log(`${queue.length} cloud agent task runs to fire (${agentTaskRunsPerCell} per task per codebase version, existing agent task runs kept).`);

fs.mkdirSync(agentTaskRunsDir, {recursive: true});
let stopped = false;
for (const {task, codebaseVersion, index} of queue) {
	const agentTaskRunId = crypto.randomBytes(4).toString('hex');
	try {
		// Fires go one at a time: 60 fires take about a minute, and a sequential loop stops at the first error.
		// eslint-disable-next-line no-await-in-loop
		const session = await fireRoutine(routines[cellKey(task.id, codebaseVersion)], agentTaskRunId);
		fired[agentTaskRunId] = {codebaseVersion, task: task.id, index, firedAt: new Date().toISOString(), ...session};
		writeJson(firedFile, fired);
		console.log(`${agentTaskRunId}: fired ${task.id} (${index + 1} of ${agentTaskRunsPerCell}) ${session.sessionUrl}`);
	} catch (error) {
		const wait = error instanceof FireError && error.retryAfterSeconds ? ` Retry after ${error.retryAfterSeconds} seconds.` : '';
		console.error(`Stopped at ${task.id}, agent task run ${index + 1}: ${error.message}.${wait}`);
		stopped = true;
		break;
	}
}

console.log(stopped ? 'Stopped early. Run the script again to fire the rest.' : 'Done. Next: node scripts/collect-cloud-agent-task-runs.mjs, once the cloud agent task runs have finished.');
process.exitCode = stopped ? 1 : 0;
