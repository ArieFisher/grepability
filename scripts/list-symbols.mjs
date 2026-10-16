// Lists the names that match a pattern, grouped by the declaration each resolves to.
// Helps a person pick seeds for a concept. Usage: node list-symbols.mjs <codebase version> <regex>
import path from 'node:path';
import ts from 'typescript';
import {codebaseVersionDir, corpusFiles, createService, relative} from './lib.mjs';

const [codebaseVersion, patternSource] = process.argv.slice(2);
const root = codebaseVersionDir(codebaseVersion);
const pattern = new RegExp(patternSource, 'i');
const service = createService(root);
const program = service.getProgram();
const checker = program.getTypeChecker();
const groups = new Map();

for (const file of corpusFiles(root)) {
	const sf = program.getSourceFile(path.join(root, file));
	const visit = node => {
		if ((ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && pattern.test(node.text)) {
			const symbol = checker.getSymbolAtLocation(node);
			const declaration = symbol?.declarations?.[0];
			const where = declaration
				? `${relative(root, declaration.getSourceFile().fileName)}:${declaration.getSourceFile().getLineAndCharacterOfPosition(declaration.getStart()).line + 1}`
				: '(no symbol)';
			const id = `${node.text} @ ${where}`;
			if (!groups.has(id)) {
				groups.set(id, []);
			}

			groups.get(id).push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
		}

		ts.forEachChild(node, visit);
	};

	visit(sf);
}

for (const [id, uses] of [...groups].sort()) {
	console.log(`${id}  (${uses.length} uses) ${uses.slice(0, 6).join(' ')}${uses.length > 6 ? ' …' : ''}`);
}

