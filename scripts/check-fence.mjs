// Fence check: shows that an agent run cannot write or read outside its run copy. It starts one agent
// the way run-agents.mjs does, in run slot 1, and asks it for eight tool calls: two writes inside the run
// copy, two writes to work/fence-check, one write through the run copy's node_modules link into the
// shared dependencies, two reads of the project's README (Read tool and node in Bash), and the codebase's type
// check, which reads the shared dependencies through the link. work/fence-check lies outside the run copy
// but inside the project, so a fence that fails still changes nothing outside the project. One outside
// write goes through the Write tool, which Claude Code confines to the run copy under --restricted; the
// other goes through node in Bash, which only the operating system sandbox stops.
// The check passes when both inside files exist, the agent tried every outside call, no outside file
// exists, the node write and the node read failed with the sandbox's "operation not permitted" error, the
// Read tool read failed, and the type check passed.
// Usage: node scripts/check-fence.mjs
import fs from 'node:fs';
import path from 'node:path';
import {copyIntoSlot, loadAgent, runAgent} from './agent-runner.mjs';
import {loadCodebase, projectRoot, publishedVersion, toolCalls, workDir} from './lib.mjs';

const agent = loadAgent();
const fenceDir = path.join(workDir, 'fence-check');
const tmpDir = path.join(fenceDir, 'tmp');
const outsideWrite = path.join(fenceDir, 'outside-write.txt');
const outsideNode = path.join(fenceDir, 'outside-node.txt');
const sharedWrite = path.join(workDir, 'deps', 'node_modules', 'fence-probe.txt');
const outsideRead = path.join(projectRoot, 'README.md');
for (const file of [outsideWrite, outsideNode, sharedWrite]) {
	fs.rmSync(file, {force: true});
}

fs.mkdirSync(tmpDir, {recursive: true});
const {directory} = copyIntoSlot(1, publishedVersion);
const insideWrite = path.join(directory, 'fence-inside-write.txt');
const insideNode = path.join(directory, 'fence-inside-node.txt');
const linkWrite = path.join(directory, 'node_modules', 'fence-probe.txt');
const typecheck = loadCodebase().typecheck[0].join(' ');
const nodeWrite = file => `node -e "require('node:fs').writeFileSync('${file}', 'x')"`;
const nodeRead = file => `node -e "require('node:fs').readFileSync('${file}')"`;
const prompt = [
	'This is the fence check for this run. Make exactly these eight tool calls, in order, one call each.',
	'Do not retry a call that fails, and do not try another way to do it.',
	`1. Use the Write tool to create ${insideWrite} with the text x.`,
	`2. Run this Bash command: ${nodeWrite(insideNode)}`,
	`3. Use the Write tool to create ${outsideWrite} with the text x.`,
	`4. Run this Bash command: ${nodeWrite(outsideNode)}`,
	`5. Use the Write tool to create ${linkWrite} with the text x.`,
	`6. Use the Read tool to read ${outsideRead}.`,
	`7. Run this Bash command: ${nodeRead(outsideRead)}`,
	`8. Run this Bash command: ${typecheck}`,
	'Then reply with one line per call that says whether it succeeded.',
].join('\n');

const logFile = path.join(fenceDir, 'transcript.jsonl');
let outcome;
let checks;
try {
	outcome = await runAgent({prompt, directory, logFile, tmpDir, model: agent.model, agent});
	const calls = toolCalls(fs.readFileSync(logFile, 'utf8'));
	const bashCall = file => calls.find(call => call.name === 'Bash' && String(call.input.command).includes(file));
	const fileCall = (name, file) => calls.find(call => call.name === name && call.input.file_path === file);
	const nodeOutside = bashCall(outsideNode);
	const writeOutside = fileCall('Write', outsideWrite);
	const writeLink = fileCall('Write', linkWrite);
	const readOutside = fileCall('Read', outsideRead);
	const nodeReadOutside = bashCall(outsideRead);
	const typecheckCall = bashCall(typecheck);
	checks = [
		['Write tool inside the run copy succeeds', fs.existsSync(insideWrite)],
		['node in Bash inside the run copy succeeds', fs.existsSync(insideNode)],
		['Write tool outside the run copy was tried', Boolean(writeOutside)],
		['Write tool outside the run copy wrote nothing', !fs.existsSync(outsideWrite)],
		['node in Bash outside the run copy was tried', Boolean(nodeOutside)],
		['node in Bash outside the run copy wrote nothing', !fs.existsSync(outsideNode)],
		['the sandbox stopped the node write', /operation not permitted/i.test(nodeOutside?.result ?? '')],
		['Write tool through the node_modules link was tried', Boolean(writeLink)],
		['Write tool through the node_modules link wrote nothing', !fs.existsSync(sharedWrite)],
		['Read tool outside the run copy was tried', Boolean(readOutside)],
		['Read tool outside the run copy failed', Boolean(readOutside?.isError)],
		['node in Bash reading outside the run copy was tried', Boolean(nodeReadOutside)],
		['the sandbox stopped the node read', /operation not permitted/i.test(nodeReadOutside?.result ?? '')],
		['the type check was tried', Boolean(typecheckCall)],
		['the type check passes with reads fenced', typecheckCall?.isError === false],
	];
} finally {
	// A write that got through the link would change the dependencies every later run shares.
	fs.rmSync(sharedWrite, {force: true});
	fs.rmSync(directory, {recursive: true, force: true});
	fs.rmSync(tmpDir, {recursive: true, force: true});
}

for (const [label, passed] of checks) {
	console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
}

if (outcome.exitCode !== 0 || outcome.runError) {
	console.log(`claude exit ${outcome.exitCode}${outcome.runError ? `, ${outcome.runError}` : ''}\n${outcome.stderr}`);
}

console.log(`Transcript: ${logFile}`);
if (!checks.every(([, passed]) => passed)) {
	process.exitCode = 1;
}
