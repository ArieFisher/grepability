// Cloud runs: prints the instructions to paste into each routine's Instructions box on claude.ai/code/routines.
// One routine exists per task and version, and routines of the same task share one text. The text is the task
// prompt from config/tasks.json plus how the run reports its work, so the task prompt has one copy.
// Usage: node routine-prompts.mjs [task-id]
import {cloudPrompt, loadCloud} from './cloud.mjs';
import {loadTasks, versions} from './lib.mjs';

const [only] = process.argv.slice(2);
const cloud = loadCloud();
const tasks = loadTasks().tasks.filter(task => !only || task.id === only);
if (tasks.length === 0) {
	throw new Error(`Unknown task ${only}`);
}

for (const task of tasks) {
	console.log(`=== ${task.id} (create ${versions.length} routines with this text) ===\n\n${cloudPrompt(task, cloud)}\n`);
}
