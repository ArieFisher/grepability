// Shared helpers: codebase configuration, file lists, TypeScript language service, comment lines, test reruns.
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {key} from './helpers.mjs';

export * from './helpers.mjs';

export const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const workDir = path.join(projectRoot, 'work');
// The two versions of the codebase: the published codebase and the proposed codebase. Each lives in work/<version>.
export const versions = ['published', 'proposed'];
export const versionDir = version => path.join(workDir, version);
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const writeJson = (file, data) => {
	fs.mkdirSync(path.dirname(file), {recursive: true});
	fs.writeFileSync(file, JSON.stringify(data, null, '\t') + '\n');
};

export const loadConcepts = () => readJson(path.join(projectRoot, 'config', 'concepts.json'));

// The codebase: which repository and commit the experiment runs on, which files form the corpus,
// and how to type-check and test it. Every field is required, so a missing one fails here rather
// than as an undefined deep inside a script.
const codebaseFile = path.join(projectRoot, 'config', 'codebase.json');
let codebaseCache;
export const loadCodebase = () => {
	if (codebaseCache) {
		return codebaseCache;
	}

	const codebase = readJson(codebaseFile);
	const required = ['repository', 'commit', 'corpus.directory', 'corpus.extension', 'typecheck', 'tests.directory', 'tests.extension', 'tests.skip', 'tests.command', 'tests.rerun', 'tests.titleSeparator'];
	const missing = required.filter(field => field.split('.').reduce((value, part) => value?.[part], codebase) === undefined);
	if (missing.length > 0) {
		throw new Error(`${codebaseFile} is missing: ${missing.join(', ')}`);
	}

	codebaseCache = codebase;
	return codebase;
};

// Corpus: every file with the corpus extension under the corpus directory, as repo-relative paths.
export const corpusFiles = root => {
	const {directory, extension} = loadCodebase().corpus;
	return fs.readdirSync(path.join(root, directory), {recursive: true})
		.filter(file => file.endsWith(extension))
		.map(file => path.join(directory, file).split(path.sep).join('/'))
		.sort();
};

// Whether a repo-relative file:line key or path lies in the corpus.
export const inCorpus = fileOrKey => fileOrKey.startsWith(`${loadCodebase().corpus.directory}/`);

// Language service over the project's own tsconfig.json, so references match what the compiler sees.
// Files can be overridden in memory (used when applying renames).
export const createService = (root, overrides = new Map()) => {
	const configPath = path.join(root, 'tsconfig.json');
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, {noEmit: true}, configPath);
	const files = parsed.fileNames;
	const host = {
		getScriptFileNames: () => files,
		// Version by content, so an override that keeps the length still invalidates the snapshot.
		getScriptVersion: file => overrides.has(file) ? crypto.createHash('sha1').update(overrides.get(file)).digest('hex') : '0',
		getScriptSnapshot(file) {
			if (overrides.has(file)) {
				return ts.ScriptSnapshot.fromString(overrides.get(file));
			}

			if (!fs.existsSync(file)) {
				return undefined;
			}

			return ts.ScriptSnapshot.fromString(fs.readFileSync(file, 'utf8'));
		},
		getCurrentDirectory: () => root,
		getCompilationSettings: () => parsed.options,
		getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
		fileExists: ts.sys.fileExists,
		readFile: ts.sys.readFile,
		readDirectory: ts.sys.readDirectory,
		directoryExists: ts.sys.directoryExists,
		getDirectories: ts.sys.getDirectories,
	};
	return ts.createLanguageService(host, ts.createDocumentRegistry());
};

export const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');

// Character offset of `name` on a 1-based line; `nth` picks a later occurrence on the same line.
export const positionOf = (root, file, line, name, nth = 0) =>
	positionInText(fs.readFileSync(path.join(root, file), 'utf8'), file, line, name, nth);

export const positionInText = (text, file, line, name, nth = 0) => {
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const lineStart = sf.getPositionOfLineAndCharacter(line - 1, 0);
	const lineText = text.slice(lineStart).split('\n')[0];
	let column = -1;
	for (let i = 0; i <= nth; i++) {
		column = findIdentifier(lineText, name, column + 1);
		if (column === -1) {
			throw new Error(`Identifier ${name} (occurrence ${nth}) not found at ${file}:${line}`);
		}
	}

	return lineStart + column;
};

const findIdentifier = (lineText, name, from) => {
	const pattern = new RegExp(`(?<![\\w$#])${name.replaceAll(/[$#]/g, String.raw`\$&`)}(?![\\w$])`, 'g');
	pattern.lastIndex = from;
	const match = pattern.exec(lineText);
	return match ? match.index : -1;
};

export const lineOf = (root, file, position) => {
	const text = fs.readFileSync(path.join(root, file), 'utf8');
	return text.slice(0, position).split('\n').length;
};

// Every comment line (1-based) per file, with its text.
export const commentLines = root => {
	const result = [];
	for (const file of corpusFiles(root)) {
		const text = fs.readFileSync(path.join(root, file), 'utf8');
		const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
		const seen = new Set();
		const lines = new Set();
		const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
		for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
			if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
				const start = scanner.getTokenStart();
				if (seen.has(start)) {
					continue;
				}

				seen.add(start);
				const first = sf.getLineAndCharacterOfPosition(start).line;
				const last = sf.getLineAndCharacterOfPosition(scanner.getTokenEnd()).line;
				for (let line = first; line <= last; line++) {
					lines.add(line + 1);
				}
			}
		}

		const textLines = text.split('\n');
		for (const line of [...lines].sort((a, b) => a - b)) {
			const lineText = textLines[line - 1].trim();
			if (/^(?:\/\*\*?|\*\/|\*|\/\/)?$/.test(lineText)) {
				continue; // Comment delimiters and blank comment lines carry no words.
			}

			result.push({file, line, text: lineText});
		}
	}

	return result;
};

// Path of the hidden test inside a run copy. The name is fixed so scoring can pick its results out of the test run.
export const hiddenTestPath = root => {
	const {directory, extension} = loadCodebase().tests;
	return path.join(root, directory, `hidden-acceptance${extension}`);
};

export const isHiddenTest = title => title.startsWith('hidden-acceptance');

// Reruns one test a few times by its TAP title; returns how many runs passed. The codebase's rerun
// command is a template: {file} is the test file the title starts with, {name} the rest of the title.
// A `*` in the name is escaped so a runner that matches names as globs takes it literally.
export const rerunTest = (root, title, times = 3) => {
	const {tests} = loadCodebase();
	const [file, ...nameParts] = title.split(tests.titleSeparator);
	const name = nameParts.join(tests.titleSeparator).replaceAll('*', String.raw`\*`);
	const [command, ...args] = tests.rerun.map(part => part
		.replaceAll('{file}', `${tests.directory}/${file}${tests.extension}`)
		.replaceAll('{name}', name));
	let passed = 0;
	for (let i = 0; i < times; i++) {
		const result = spawnSync(command, args, {cwd: root, encoding: 'utf8'});
		if (result.status === 0 && /^ok \d+ /m.test(result.stdout)) {
			passed++;
		}
	}

	return passed;
};

// Compares two test-result files. A test whose result differs is rerun in both copies;
// if it both passes and fails across reruns it is reported as flaky, not as a difference.
export const compareTests = (resultA, resultB) => {
	const names = Object.keys({...resultA.tests, ...resultB.tests});
	const changed = names.filter(name => resultA.tests[name] !== resultB.tests[name]);
	const differences = [];
	const flaky = [];
	for (const name of changed) {
		if (resultA.tests[name] === undefined || resultB.tests[name] === undefined) {
			differences.push({name, a: resultA.tests[name], b: resultB.tests[name]});
			continue;
		}

		const passesA = rerunTest(resultA.directory, name);
		const passesB = rerunTest(resultB.directory, name);
		if ((passesA > 0 && passesA < 3) || (passesB > 0 && passesB < 3) || (passesA > 0) === (passesB > 0)) {
			flaky.push(name);
		} else {
			differences.push({name, a: passesA === 3, b: passesB === 3});
		}
	}

	return {differences, flaky};
};
