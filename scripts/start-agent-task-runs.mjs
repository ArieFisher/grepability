// Agent score: starts the agent on each task in each codebase version, in fresh, identical-looking agent task run
// copies. Same tools and no user settings in every local agent task run. Each agent task run gets a random id; the
// id-to-codebase-version key is kept in work/agent-task-runs/key.json so scoring can be blind.
// Each agent task run starts in an agent task run slot (see agent-runner.mjs), then its agent task run copy moves
// to work/agent-task-runs/<id>/ so scoring can execute its codebase verification suite later.
// Usage: node start-agent-task-runs.mjs [--agent-task-runs 10] [--tasks find-all,rename,retry-count-start] [--codebase-versions published,proposed] [--parallel 2] [--model sonnet]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {agentTaskRunCopyName, checkAgentTaskRunSlotsEmpty, copyIntoAgentTaskRunSlot, loadAgent, runAgent} from './agent-runner.mjs';
import {codebaseVersions, diffSinceSnapshot, integerOption, interleave, loadTasks, missingAgentTaskRuns, option, readJson, summarizeTranscript, workDir, writeJson} from './lib.mjs';

const argv = process.argv.slice(2);
const config = loadTasks();
const agent = loadAgent();
const agentTaskRunsPerCell = integerOption(argv, 'agent-task-runs', 10, 1);
const taskIds = option(argv, 'tasks', config.tasks.map(task => task.id).join(',')).split(',');
const selectedCodebaseVersions = option(argv, 'codebase-versions', codebaseVersions.join(',')).split(',');
const parallel = integerOption(argv, 'parallel', 2, 1);
const model = option(argv, 'model', agent.model);
const agentTaskRunsDir = path.join(workDir, 'agent-task-runs');
const keyFile = path.join(agentTaskRunsDir, 'key.json');
fs.mkdirSync(agentTaskRunsDir, {recursive: true});
const key = fs.existsSync(keyFile) ? readJson(keyFile) : {};

const selectedTasks = taskIds.map(taskId => {
	const task = config.tasks.find(item => item.id === taskId);
	if (!task) {
		throw new Error(`Unknown task ${taskId}`);
	}

	return task;
});
const jobs = missingAgentTaskRuns(selectedTasks, selectedCodebaseVersions, agentTaskRunsPerCell, (task, codebaseVersion) => Object.values(key).filter(entry => entry.task === task.id && entry.codebaseVersion === codebaseVersion).length);

// Round-robin over cells (task x codebase version), shuffled within each round, so drift in the model service
// over time hits every cell alike.
const queue = interleave(jobs, job => `${job.task.id}|${job.codebaseVersion}`);
console.log(`${queue.length} agent task runs to do (${agentTaskRunsPerCell} per task per codebase version, existing agent task runs kept).`);

// Each worker uses its own slot, one agent task run at a time.
const slots = Array.from({length: parallel}, (_, index) => index + 1);
checkAgentTaskRunSlotsEmpty(slots);
const worker = async slot => {
	while (queue.length > 0) {
		const {task, codebaseVersion, index} = queue.shift();
		const agentTaskRunId = crypto.randomBytes(4).toString('hex');
		const agentTaskRunDir = path.join(agentTaskRunsDir, agentTaskRunId);
		const tmpDir = path.join(agentTaskRunDir, 'tmp');
		fs.mkdirSync(tmpDir, {recursive: true});
		const {directory: slotCopy, snapshot} = copyIntoAgentTaskRunSlot(slot, codebaseVersion);
		const transcript = path.join(agentTaskRunDir, 'transcript.jsonl');
		// eslint-disable-next-line no-await-in-loop
		const outcome = await runAgent({prompt: task.prompt, directory: slotCopy, logFile: transcript, tmpDir, model, agent});
		const summary = summarizeTranscript(fs.readFileSync(transcript, 'utf8'));
		// An agent that deleted the agent task run copy's .git leaves no diff to take. The script records the agent
		// task run as an error with an empty diff.
		let diff = '';
		let diffError;
		try {
			diff = diffSinceSnapshot(slotCopy, snapshot);
		} catch (error) {
			diffError = `diff failed: ${error.message.split('\n')[0]}`;
		}

		const directory = path.join(agentTaskRunDir, agentTaskRunCopyName());
		fs.renameSync(slotCopy, directory);
		fs.rmSync(tmpDir, {recursive: true, force: true});
		fs.writeFileSync(path.join(agentTaskRunDir, 'diff.patch'), diff);
		fs.writeFileSync(path.join(agentTaskRunDir, 'final.md'), summary.finalText);
		const agentTaskRunError = [outcome.agentTaskRunError, diffError].filter(Boolean).join('; ') || undefined;
		writeJson(path.join(agentTaskRunDir, 'run.json'), {agentTaskRunId, task: task.id, directory, snapshot, model, ...outcome, ...summary, agentTaskRunError, finalText: undefined});
		key[agentTaskRunId] = {codebaseVersion, task: task.id, index};
		writeJson(keyFile, key);
		console.log(`${agentTaskRunId}: ${task.id} done in ${Math.round(outcome.wallMs / 1000)}s, $${summary.costUsd?.toFixed(2) ?? '?'}${outcome.exitCode === 0 ? '' : `, exit ${outcome.exitCode}`}${agentTaskRunError ? `, ${agentTaskRunError}` : ''}`);
	}
};

await Promise.all(slots.map(slot => worker(slot)));
console.log('Done. Next: node scripts/score-agents.mjs');
