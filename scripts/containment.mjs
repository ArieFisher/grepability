// Containment: keeps every write the experiment makes inside the project. Commands the scripts start
// get a temporary folder and an npm cache inside the project. Each local agent task run has the Claude Code
// sandbox on and its file tools confined to its agent task run copy.
import path from 'node:path';

// The environment for a command the scripts start. Node, tsx, and ava write temporary files under
// TMPDIR, and npm and npx write their cache and logs under npm_config_cache. Both point into tmpDir,
// which lies inside the project, in place of the system temporary folder and ~/.npm.
export const containedEnv = (env, tmpDir) => ({
	...env,
	TMPDIR: tmpDir,
	npm_config_cache: path.join(tmpDir, 'npm-cache'),
});

// The environment for one agent task run: the contained environment, plus CLAUDE_CODE_TMPDIR, which moves
// Claude Code's own temporary files, the sandbox's temporary folder among them, into tmpDir.
export const agentEnv = (env, tmpDir) => ({...containedEnv(env, tmpDir), CLAUDE_CODE_TMPDIR: tmpDir});

// The Claude Code settings for one agent task run, passed with --settings.
// - With enabled, Claude Code runs every Bash command inside the operating system sandbox (Seatbelt on
//   macOS). A sandboxed command can write only to the working directory, which is the agent task run copy, and the
//   allowWrite paths.
// - With failIfUnavailable, Claude Code exits at startup when the sandbox cannot start, so no agent task run falls
//   back to unsandboxed commands.
// - With allowUnsandboxedCommands: false, Claude Code gives a blocked command no retry outside the sandbox.
// - With autoAllowBashIfSandboxed: false, Claude Code runs only the commands the allowedTools list matches.
// - allowWrite lists the agent task run's temporary folder, which holds TMPDIR and the npm cache.
// - denyRead and allowRead come from reads (see readLimits in agent-runner.mjs). The sandbox lets a command
//   read most of the machine by default; where the two lists overlap, the sandbox applies the narrower path.
// - With allowLocalBinding, the sandbox lets the codebase verification suite start and reach local servers. It
//   blocks every other host.
export const agentSettings = (tmpDir, reads) => ({
	sandbox: {
		enabled: true,
		failIfUnavailable: true,
		allowUnsandboxedCommands: false,
		autoAllowBashIfSandboxed: false,
		filesystem: {allowWrite: [tmpDir], denyRead: reads.denyRead, allowRead: reads.allowRead},
		network: {allowLocalBinding: true},
	},
});

// The allowedTools list may hold only Bash command rules. A bare file tool rule such as Edit approves
// that tool on every path, outside the agent task run copy too.
export const checkAllowedTools = allowedTools => {
	const loose = allowedTools.filter(rule => !/^Bash\(.+\)$/.test(rule));
	if (loose.length > 0) {
		throw new Error(`config/tasks.json: agent.allowedTools may hold only Bash(...) rules; remove ${loose.join(', ')}`);
	}
};

// The claude arguments for one agent task run.
// Under --restricted, Claude Code confines the file tools (Read, Edit, Write, Grep, Glob) to the working
// directory and loads no user, project, or local settings file, so the settings below are the only ones
// besides any managed settings. Claude Code keeps Bash because --tools lists it. Under acceptEdits, Claude
// Code approves file edits inside the working directory without a prompt, and denies a call that would
// prompt, because a session started with -p has no one to ask.
export const agentArgs = ({prompt, model, agent, tmpDir, reads}) => {
	checkAllowedTools(agent.allowedTools);
	return [
		'-p', prompt,
		'--model', model,
		'--output-format', 'stream-json', '--verbose',
		'--restricted',
		'--settings', JSON.stringify(agentSettings(tmpDir, reads)),
		'--permission-mode', 'acceptEdits',
		'--tools', agent.tools,
		'--allowedTools', ...agent.allowedTools,
		'--strict-mcp-config',
		'--no-session-persistence',
		'--max-budget-usd', String(agent.maxBudgetUsd),
	];
};
