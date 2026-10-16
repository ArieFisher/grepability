// Starts local agent task runs: a fresh agent task run copy in a fixed agent task run slot, then claude in that
// copy, contained as containment.mjs describes. start-agent-task-runs.mjs and check-fence.mjs both start agents
// through here.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {agentArgs, agentEnv} from './containment.mjs';
import {codebaseVersionDir, loadCodebase, loadTasks, makeAgentTaskRunCopy, projectRoot, workDir} from './lib.mjs';

// The agent configuration from config/tasks.json. It fixes the model, budget, time cap, and tool allowlist of
// every local agent task run. The time cap per agent task run bounds a hung process, which the budget cap does
// not: at the cap runAgent kills the agent and records the agent task run as an error.
export const loadAgent = () => {
	const {agent} = loadTasks();
	if (!Number.isInteger(agent.timeoutMinutes) || agent.timeoutMinutes < 1) {
		throw new Error('config/tasks.json: agent.timeoutMinutes must be a whole number of at least 1');
	}

	return agent;
};

// The agent task run slots: fixed folders that agents work in, one per parallel worker. Claude Code records every
// working directory it starts in under the Claude folder in the home directory, so fixed folders keep that record to
// one entry per slot. After an agent task run, its agent task run copy moves to the agent task run's own folder.
export const agentTaskRunSlotDir = slot => path.join(workDir, 'agent-task-run-slots', String(slot));

// Every agent task run copy has the same folder name, the codebase repository's own, so all agent task run copies
// look alike from inside.
export const agentTaskRunCopyName = () => path.basename(loadCodebase().repository, '.git');

// A slot that still holds an agent task run copy is from an agent task run that stopped before its copy moved out,
// so the script stops instead of overwriting it. start-agent-task-runs.mjs checks every slot before the first agent
// task run starts, so a stale slot never stops the script while another slot's agent task run is underway.
export const checkAgentTaskRunSlotsEmpty = slots => {
	for (const slot of slots) {
		const directory = path.join(agentTaskRunSlotDir(slot), agentTaskRunCopyName());
		if (fs.existsSync(directory)) {
			throw new Error(`Agent task run slot ${directory} still holds an agent task run copy from an agent task run that did not finish. Remove it, then start again.`);
		}
	}
};

// A fresh agent task run copy of a codebase version in a slot, with its snapshot commit.
export const copyIntoAgentTaskRunSlot = (slot, codebaseVersion) => {
	checkAgentTaskRunSlotsEmpty([slot]);
	return makeAgentTaskRunCopy(codebaseVersionDir(codebaseVersion), path.join(agentTaskRunSlotDir(slot), agentTaskRunCopyName()));
};

// The sandbox read lists for one agent task run. A shell command may read nothing in the home folder or the project
// except the agent task run copy, the agent task run's temporary folder, and the shared dependencies that the agent
// task run copy's node_modules links to. It cannot read the withheld acceptance tests, the other codebase version,
// the key, or the secrets and settings in the home folder, which could otherwise reach a transcript or a diff. The
// project is listed on its own because it may lie outside the home folder.
export const readLimits = (directory, tmpDir) => ({
	denyRead: [os.homedir(), projectRoot],
	allowRead: [directory, tmpDir, path.join(workDir, 'deps')],
});

// Runs claude on one prompt in an agent task run copy and writes its transcript to logFile. tmpDir must exist; it
// holds the agent task run's temporary files and npm cache. Resolves with the exit code, wall time, the start of
// stderr, and an agent task run error when the agent did not start or hit the time cap.
export const runAgent = ({prompt, directory, logFile, tmpDir, model, agent}) => new Promise(resolve => {
	const started = Date.now();
	const log = fs.createWriteStream(logFile);
	const child = spawn(agent.command, agentArgs({prompt, model, agent, tmpDir, reads: readLimits(directory, tmpDir)}), {cwd: directory, env: agentEnv(process.env, tmpDir), stdio: ['ignore', 'pipe', 'pipe']});
	child.stdout.pipe(log, {end: false});
	let stderr = '';
	let runError;
	child.stderr.on('data', data => {
		stderr += data;
	});
	log.on('error', error => {
		runError = `transcript write failed: ${error.message}`;
	});
	const timer = setTimeout(() => {
		runError = `killed after ${agent.timeoutMinutes} minutes`;
		child.kill('SIGKILL');
	}, agent.timeoutMinutes * 60_000);
	// The result goes out once the transcript file has closed, so a reader of the transcript sees the last event.
	let finished = false;
	const finish = exitCode => {
		if (finished) {
			return;
		}

		finished = true;
		clearTimeout(timer);
		log.end(() => resolve({exitCode, wallMs: Date.now() - started, stderr: stderr.slice(0, 2000), runError}));
	};

	child.on('error', error => {
		runError = `agent did not start: ${error.message}`;
		finish(null);
	});
	child.on('close', code => finish(code));
});
