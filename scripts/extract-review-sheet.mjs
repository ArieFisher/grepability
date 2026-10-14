// Writes the reviewer sheet: every comment line and every line holding a string literal in the published codebase.
// Reviewers tag each row with the concept ids it refers to. Names in code are covered by the type checker.
// Usage: node extract-review-sheet.mjs
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {commentLines, corpusFiles, key, projectRoot, publishedVersion, toCsv, versionDir} from './lib.mjs';

const root = versionDir(publishedVersion);
const rows = new Map();
for (const {file, line, text} of commentLines(root)) {
	rows.set(key(file, line), {file, line, kind: 'comment', text});
}

for (const file of corpusFiles(root)) {
	const text = fs.readFileSync(path.join(root, file), 'utf8');
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const textLines = text.split('\n');
	const visit = node => {
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
			const first = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
			const last = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
			for (let line = first; line <= last; line++) {
				const id = key(file, line);
				const isImport = ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent);
				if (!rows.has(id) && !isImport) {
					rows.set(id, {file, line, kind: 'string', text: textLines[line - 1].trim()});
				}
			}

			return;
		}

		ts.forEachChild(node, visit);
	};

	visit(sf);
}

const sorted = [...rows.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const output = path.join(projectRoot, 'truth', 'review-sheet.csv');
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, toCsv([
	['file', 'line', 'kind', 'concepts', 'text'],
	...sorted.map(row => [row.file, row.line, row.kind, '', row.text]),
]));
console.log(`${sorted.length} lines (${sorted.filter(row => row.kind === 'comment').length} comment, ${sorted.filter(row => row.kind === 'string').length} string) -> ${output}`);
console.log('Each reviewer copies this file to truth/reviewer-<name>.csv and fills the concepts column with space-separated concept ids.');
