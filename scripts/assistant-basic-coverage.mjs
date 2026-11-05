import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

export const BASIC_SURFACE_ROOTS = ['app/dashboard', 'app/_components', 'app/auth/switch-account', 'app/suppression-compte'];
export const BASIC_REVIEW_FILE = 'scripts/assistant-basic-surface-reviews.json';
export const BASIC_FRAGMENT_FILES = ['scripts/assistant-basic-surfaces-account.json', 'scripts/assistant-basic-surfaces-media.json', 'scripts/assistant-basic-surfaces-shell.json', 'scripts/assistant-basic-surfaces-history-plan.json'];
export const BASIC_SCOPE_FRAGMENT_FILES = BASIC_FRAGMENT_FILES.map(file => file.replace('assistant-basic-surfaces-', 'assistant-basic-file-scope-'));
const normalized = value => value.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
const digest = value => createHash('sha256').update(value).digest('hex');
const compact = value => value.replace(/\s+/g, ' ').trim();
function walk(root, path) {
  if (!existsSync(join(root, path))) return [];
  return readdirSync(join(root, path), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(root, `${path}/${entry.name}`) : /\.tsx$/.test(entry.name) ? [`${path}/${entry.name}`] : []);
}
function propertyName(node, ast) { return node.name?.getText(ast).replace(/^["']|["']$/g, '') ?? ''; }

/** Inventory syntax, never infer edition rights from a filename or a label.
 * Each excluded file/control needs a separately reviewed access-gate reason.
 * A repeated map template represents one control with runtime choices, not one
 * fictional control per account record. No application data enters this report. */
export function scanBasicSurfaceCandidates(root, roots = BASIC_SURFACE_ROOTS) {
  const files = [...new Set(roots.flatMap(path => walk(root, path)))].sort();
  return files.map(file => {
    const source = normalized(readFileSync(join(root, file), 'utf8'));
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const controls = [], repetitions = new Map();
    const visit = node => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(ast), attrs = node.attributes.properties;
        const names = attrs.filter(ts.isJsxAttribute).map(attr => propertyName(attr, ast));
        const interactive = /^(?:button|input|textarea|select|option|a|Link|form|summary)$/.test(tag) || names.includes('contentEditable') || names.some(name => /^(?:onClick|onChange|onInput|onPaste|onSubmit|onSelect|onValueChange|onCheckedChange)$/.test(name)) || /(?:Button|Select|Checkbox|Switch|Toggle|MenuItem|TabTrigger|DialogTrigger|DropdownItem)$/.test(tag);
        if (interactive) {
          const element = ts.isJsxOpeningElement(node) ? node.parent : node;
          const opening = compact(node.getText(ast));
          const text = compact(element.getText(ast));
          const label = ts.isJsxElement(element) ? compact(element.children.filter(ts.isJsxText).map(child => child.text).join(' ')) : '';
          const identity = digest(`${tag}\0${opening}\0${label}`).slice(0, 16);
          const occurrence = (repetitions.get(identity) ?? 0) + 1; repetitions.set(identity, occurrence);
          const conditions = [], branches = []; let component = '';
          for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
            if (ts.isConditionalExpression(ancestor)) conditions.push(compact(ancestor.condition.getText(ast)).slice(0, 300));
            if (ts.isConditionalExpression(ancestor)) branches.push({ condition: compact(ancestor.condition.getText(ast)).slice(0, 300), branch: node.getStart(ast) >= ancestor.whenTrue.getStart(ast) && node.getEnd() <= ancestor.whenTrue.getEnd() ? 'then' : 'else' });
            if (ts.isBinaryExpression(ancestor) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(ancestor.operatorToken.kind)) conditions.push(compact(ancestor.left.getText(ast)).slice(0, 300));
            if (ts.isIfStatement(ancestor)) conditions.push(compact(ancestor.expression.getText(ast)).slice(0, 300));
            if (!component && ts.isFunctionDeclaration(ancestor)) component = ancestor.name?.getText(ast) ?? '';
          }
          const handlers = attrs.filter(ts.isJsxAttribute).filter(attr => /^on/.test(propertyName(attr, ast))).map(attr => compact(attr.getText(ast)));
          controls.push({ id: `${file}#${tag}:${identity}:${occurrence}`, file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, tag, opening, label, handlers, conditions, branches, component, snippet: text.slice(0, 1400), start: node.getStart(ast), end: element.getEnd() });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    return { file, sourceDigest: digest(source), controls };
  }).filter(file => file.controls.length);
}

function publicCapabilities(root) {
  const file = 'lib/inrAssistantActionCoverage.ts', source = normalized(readFileSync(join(root, file), 'utf8'));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(module,exports){${compiled}\n})(module,module.exports)`, { module: moduleRecord }, { timeout: 2000, filename: file });
  return moduleRecord.exports.INR_ASSISTANT_ACTION_COVERAGE;
}
function readFragments(root) {
  return BASIC_FRAGMENT_FILES.flatMap(file => {
    if (!existsSync(join(root, file))) throw new Error(`Missing reviewed surface fragment: ${file}`);
    const rows = JSON.parse(readFileSync(join(root, file), 'utf8'));
    if (!Array.isArray(rows)) throw new Error(`Surface fragment must be an array: ${file}`);
    return rows;
  });
}
export function namedBasicRegressionExists(source, title) {
  const ast = ts.createSourceFile('proof.mts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  const disabledCall = node => {
    if (!ts.isCallExpression(node)) return false;
    if (/^(?:test|it|describe)\.(?:skip|todo)$/.test(node.expression.getText(ast))) return true;
    return /^(?:test|it|describe)(?:\.only)?$/.test(node.expression.getText(ast)) && node.arguments.some(argument => ts.isObjectLiteralExpression(argument) && argument.properties.some(property => ts.isPropertyAssignment(property) && ['skip', 'todo'].includes(propertyName(property, ast)) && property.initializer.kind !== ts.SyntaxKind.FalseKeyword));
  };
  const active = node => { for (let ancestor = node; ancestor; ancestor = ancestor.parent) if (disabledCall(ancestor)) return false; return true; };
  function visit(node) {
    if (ts.isCallExpression(node) && /^(?:test|it)(?:\.only)?$/.test(node.expression.getText(ast)) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === title && active(node)) found = true;
    ts.forEachChild(node, visit);
  }
  visit(ast); return found;
}
export function basicCoverageReviewInventory(root, candidates, rows, fileReviews) {
  return { formatVersion: 3, fragmentsDigest: digest(JSON.stringify(rows)), evidenceDigests: basicEvidenceDigests(root, rows, fileReviews), files: Object.fromEntries(candidates.map(file => [file.file, { ...fileReviews[file.file], sourceDigest: file.sourceDigest, controlIds: file.controls.map(control => control.id) }])) };
}

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const LOCAL_EVIDENCE_FILE = /\.(?:[cm]?[jt]sx?|json|css)$/;
function localFile(root, importer, specifier) {
  if (typeof specifier !== 'string' || !(specifier.startsWith('@/') || specifier.startsWith('.')) || /[\u0000?]/.test(specifier)) return null;
  const base = resolve(root, specifier.startsWith('@/') ? specifier.slice(2) : join(dirname(importer), specifier));
  const inside = relative(resolve(root), base);
  if (!inside || inside.startsWith('..') || isAbsolute(inside) || !/^(?:app|lib|tests)[\\/]/.test(inside)) return null;
  const paths = [base, ...['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.json', '.css'].map(extension => base + extension), ...['index.ts', 'index.tsx', 'index.mts', 'index.mjs', 'index.js', 'index.jsx'].map(name => join(base, name))];
  if (/\.[cm]?jsx?$/.test(base)) paths.push(base.replace(/\.[cm]?jsx?$/, '.ts'), base.replace(/\.[cm]?jsx?$/, '.tsx'));
  const found = paths.find(file => LOCAL_EVIDENCE_FILE.test(file) && existsSync(file) && statSync(file).isFile());
  return found ? relative(resolve(root), found).replaceAll('\\', '/') : null;
}
function staticString(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return staticString(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) { const left = staticString(node.left), right = staticString(node.right); return left !== null && right !== null ? left + right : null; }
  return null;
}
function localImports(root, file, source) {
  if (!CODE_FILE.test(file)) return [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS), imports = [];
  const add = (node, value) => { const target = localFile(root, file, value); if (target) imports.push({ file, target, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 }); };
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) add(node, staticString(node.moduleSpecifier));
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression) add(node, staticString(node.moduleReference.expression));
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === 'require') && node.arguments[0]) add(node, staticString(node.arguments[0]));
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node, staticString(node.argument.literal));
    ts.forEachChild(node, visit);
  };
  visit(ast); return imports;
}
/** Follow native local modules and test helpers from source, proof and route seeds. External
 * packages and runtime-computed imports are not certified by this inventory. */
export function collectBasicLocalEvidenceFiles(root, seedFiles) {
  const files = new Set(seedFiles), pending = [...files];
  while (pending.length) {
    const file = pending.pop(); if (!existsSync(join(root, file)) || !statSync(join(root, file)).isFile()) continue;
    for (const imported of localImports(root, file, normalized(readFileSync(join(root, file), 'utf8')))) if (!files.has(imported.target)) { files.add(imported.target); pending.push(imported.target); }
  }
  return [...files].filter(file => existsSync(join(root, file)) && statSync(join(root, file)).isFile()).sort();
}
function allLocalCode(root, directory) {
  if (!existsSync(join(root, directory))) return [];
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? allLocalCode(root, `${directory}/${entry.name}`) : CODE_FILE.test(entry.name) ? [`${directory}/${entry.name}`] : []);
}
/** A declaration substring cannot prove that an obsolete component is unused.
 * Recheck all app/lib static imports, re-exports, dynamic literal imports,
 * require calls and named JSX/createElement uses on every verification. */
export function verifyBasicUnmountedComponent(root, file, proof) {
  const errors = [], usages = [];
  if (proof?.kind !== 'unmounted_component' || typeof proof.exportName !== 'string' || !/^[A-Z][a-zA-Z0-9_$]*$/.test(proof.exportName) || !/^(?:app|lib)\/.+\.[cm]?[jt]sx?$/.test(file) || !existsSync(join(root, file))) return { errors: ['invalid unmounted component structural proof'], usages };
  const stem = file.split('/').at(-1).replace(/\.[cm]?[jt]sx?$/, '');
  if (file.startsWith('app/') && /^(?:page|layout|template|default|loading|error|global-error|not-found|route|middleware|proxy)$/.test(stem)) errors.push('a conventional Next route entry cannot be excluded as unmounted');
  const targetSource = normalized(readFileSync(join(root, file), 'utf8')), targetAst = ts.createSourceFile(file, targetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declared = targetAst.statements.some(node => ts.isFunctionDeclaration(node) && node.name?.text === proof.exportName && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
  if (!declared) errors.push('the claimed exported component declaration is absent');
  for (const importer of [...allLocalCode(root, 'app'), ...allLocalCode(root, 'lib')]) {
    if (importer === file) continue;
    const source = normalized(readFileSync(join(root, importer), 'utf8'));
    for (const imported of localImports(root, importer, source)) if (imported.target === file) usages.push({ file: importer, line: imported.line, kind: 'local_import' });
    const ast = ts.createSourceFile(importer, source, ts.ScriptTarget.Latest, true, /x$/.test(importer) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const named = node => ts.isIdentifier(node) && node.text === proof.exportName || ts.isPropertyAccessExpression(node) && node.name.text === proof.exportName;
    const visit = node => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && named(node.tagName) || ts.isCallExpression(node) && /(?:^|\.)(?:createElement|jsx|jsxs)$/.test(node.expression.getText(ast)) && node.arguments[0] && named(node.arguments[0])) usages.push({ file: importer, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, kind: 'named_component_use' });
      ts.forEachChild(node, visit);
    }; visit(ast);
  }
  if (usages.length) errors.push('the component has a current app/lib import or render use');
  return { errors, usages };
}

/** Manual assembly only: normal guard/prebuild runs never refresh its own
 * evidence. Each of the four owners must first freeze its explicit fragment. */
export function assembleBasicAssistantSurfaceReview(root) {
  const fileReviews = {};
  for (const fragment of BASIC_SCOPE_FRAGMENT_FILES) {
    if (!existsSync(join(root, fragment))) throw new Error(`Missing reviewed file-scope fragment: ${fragment}`);
    const entries = JSON.parse(readFileSync(join(root, fragment), 'utf8'));
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error(`File-scope fragment must be an object: ${fragment}`);
    for (const [file, review] of Object.entries(entries)) { if (Object.hasOwn(fileReviews, file)) throw new Error(`Multiple owners reviewed the same surface file: ${file}`); fileReviews[file] = review; }
  }
  const candidates = scanBasicSurfaceCandidates(root);
  for (const candidate of candidates) if (!fileReviews[candidate.file]) throw new Error(`Missing explicit file-scope decision: ${candidate.file}`);
  for (const file of Object.keys(fileReviews)) if (!candidates.some(candidate => candidate.file === file)) throw new Error(`Reviewed surface file no longer has native controls: ${file}`);
  return basicCoverageReviewInventory(root, candidates, readFragments(root), fileReviews);
}

/** Changes in executors, native routes, scope gates or named proof bodies need
 * another explicit review even when a button's source anchor stays identical. */
export function basicEvidenceDigests(root, rows, fileReviews) {
  const files = new Set(rows.flatMap(row => [...(row.sourceFiles ?? []), ...(row.testFiles ?? []), ...(Array.isArray(row.additionalProofs) ? row.additionalProofs.map(proof => proof?.file).filter(file => typeof file === 'string') : [])]));
  for (const review of Object.values(fileReviews)) {
    for (const file of review.gateFiles ?? []) files.add(file);
    for (const excluded of Object.values(review.exclusions ?? {})) for (const file of excluded.gateFiles ?? []) files.add(file);
  }
  if (existsSync(join(root, 'lib'))) for (const name of readdirSync(join(root, 'lib'))) if (/^inrAssistant.*\.ts$/.test(name) && !name.endsWith('.generated.ts')) files.add(`lib/${name}`);
  for (const capability of publicCapabilities(root).filter(item => item.editions.includes('basic'))) for (const route of capability.nativeRoutes ?? []) {
    if (/^\/api\/[a-zA-Z0-9_./\[\]-]+$/.test(route) && !route.includes('..')) files.add(`app${route}/route.ts`);
  }
  return Object.fromEntries(collectBasicLocalEvidenceFiles(root, files).map(file => [file, digest(normalized(readFileSync(join(root, file), 'utf8')))]));
}

/** Coverage is a reviewed contract, not a tool permission or proof that a
 * provider has processed a write. Reports keep these evidence levels separate. */
export function verifyBasicAssistantCoverage(root, options = {}) {
  const candidates = scanBasicSurfaceCandidates(root), rows = readFragments(root);
  const reviewed = JSON.parse(readFileSync(join(root, BASIC_REVIEW_FILE), 'utf8'));
  const capabilities = new Map(publicCapabilities(root).map(item => [item.id, item]));
  const errors = [], ids = new Set(), bindings = new Map();
  // A proof shared by many native buttons is read/parsed once during this
  // verification, with no cache surviving the current source inspection.
  const proofSources = new Map(), proofResults = new Map();
  const currentNamedProof = (file, title) => {
    if (typeof file !== 'string' || !/^tests\/.+\.test\.m(?:t|j)s$/.test(file) || !existsSync(join(root, file)) || typeof title !== 'string' || !title.trim()) return false;
    const key = `${file}\0${title}`;
    if (!proofSources.has(file)) proofSources.set(file, normalized(readFileSync(join(root, file), 'utf8')));
    if (!proofResults.has(key)) proofResults.set(key, namedBasicRegressionExists(proofSources.get(file), title));
    return proofResults.get(key);
  };
  if (reviewed.fragmentsDigest !== digest(JSON.stringify(rows))) errors.push('Surface definitions changed since explicit review');
  if (JSON.stringify(reviewed.evidenceDigests) !== JSON.stringify(basicEvidenceDigests(root, rows, reviewed.files ?? {}))) errors.push('Native executors, gates or named proof bodies changed since explicit surface review');
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) errors.push(`Duplicate/missing surface id: ${row.id}`); ids.add(row.id);
    const capability = capabilities.get(row.capabilityId);
    if (!capability?.editions.includes('basic') || capability.availability === 'not_in_app') errors.push(`${row.id}: capability is not available to Basic: ${row.capabilityId}`);
    if (!['read', 'execute', 'confirm', 'handoff', 'navigate', 'form'].includes(row.mode)) errors.push(`${row.id}: invalid mode`);
    if (!row.label?.trim() || !row.notes?.trim()) errors.push(`${row.id}: missing public behavior/limits`);
    if (row.mode === 'handoff' && !row.handoffReason?.trim()) errors.push(`${row.id}: human step needs an explicit reason`);
    if (!['implemented', 'server_equivalent', 'human_required', 'gap'].includes(row.coverageStatus)) errors.push(`${row.id}: missing operational coverage status`);
    if (row.coverageStatus === 'human_required' && !row.handoffReason?.trim()) errors.push(`${row.id}: human step needs an explicit reason`);
    if (!Array.isArray(row.toolNames) || !row.toolNames.length || row.toolNames.some(name => !capability?.tools.includes(name))) errors.push(`${row.id}: tool does not implement this capability`);
    if (!Array.isArray(row.sourceFiles) || !row.sourceFiles.length || !row.sourceAnchor?.trim()) errors.push(`${row.id}: missing native source anchor`);
    else if (!row.sourceFiles.some(file => existsSync(join(root, file)) && normalized(readFileSync(join(root, file), 'utf8')).includes(row.sourceAnchor))) errors.push(`${row.id}: native source anchor is stale`);
    if (!Array.isArray(row.testFiles) || !row.testFiles.length || !row.testAnchor?.trim()) errors.push(`${row.id}: missing named regression proof`);
    else if (!row.testFiles.some(file => currentNamedProof(file, row.testAnchor))) errors.push(`${row.id}: named regression proof is stale`);
    if (row.additionalProofs !== undefined && !Array.isArray(row.additionalProofs)) errors.push(`${row.id}: additional regression proofs must be an array`);
    else for (const proof of row.additionalProofs ?? []) if (!proof || !currentNamedProof(proof.file, proof.testAnchor)) errors.push(`${row.id}: additional named regression proof is stale`);
    for (const controlId of row.controlIds ?? []) {
      if (bindings.has(controlId)) errors.push(`${controlId}: multiple surface bindings`);
      bindings.set(controlId, row.id);
    }
  }
  const basic = [], excluded = [], unresolved = [];
  for (const file of candidates) {
    const review = reviewed.files?.[file.file];
    if (!review) { unresolved.push(...file.controls); continue; }
    if (file.sourceDigest !== review.sourceDigest) errors.push(`${file.file}: UI changed since explicit surface review`);
    if (!['basic', 'out_of_pack', 'infrastructure'].includes(review.disposition) || !review.reason?.trim()) errors.push(`${file.file}: missing file scope review`);
    if (review.disposition !== 'basic') {
      if (!review.gateFiles?.length || !review.gateAnchor?.trim() || !review.gateFiles.some(path => existsSync(join(root, path)) && normalized(readFileSync(join(root, path), 'utf8')).includes(review.gateAnchor))) errors.push(`${file.file}: excluded surface has no current access gate/infrastructure evidence`);
      if (/non import|inutilis|unused|unmounted/i.test(review.reason ?? '') && !review.structuralProof) errors.push(`${file.file}: an unused component exclusion needs a current structural proof`);
      if (review.structuralProof) { const structural = verifyBasicUnmountedComponent(root, file.file, review.structuralProof); for (const error of structural.errors) errors.push(`${file.file}: ${error}`); }
      excluded.push(...file.controls); continue;
    }
    for (const control of file.controls) {
      const override = review.exclusions?.[control.id];
      if (override) {
        if (!override.reason?.trim() || !override.gateAnchor?.trim() || !(override.gateFiles ?? [file.file]).some(path => existsSync(join(root, path)) && normalized(readFileSync(join(root, path), 'utf8')).includes(override.gateAnchor))) errors.push(`${control.id}: invalid paid/technical control exclusion`);
        excluded.push(control);
      } else if (bindings.has(control.id)) basic.push(control);
      else unresolved.push(control);
    }
  }
  const known = new Set(candidates.flatMap(file => file.controls.map(control => control.id)));
  for (const id of bindings.keys()) if (!known.has(id)) errors.push(`${id}: bound UI control no longer exists`);
  for (const file of Object.keys(reviewed.files ?? {})) if (!candidates.some(item => item.file === file)) errors.push(`${file}: reviewed surface file no longer exists`);
  if (unresolved.length) errors.push(`${unresolved.length} UI controls have no reviewed Basic mapping/scope decision`);
  const rowById = new Map(rows.map(row => [row.id, row]));
  const coverageStatuses = Object.fromEntries(['implemented', 'server_equivalent', 'human_required', 'gap'].map(status => [status, basic.filter(control => rowById.get(bindings.get(control.id))?.coverageStatus === status).length]));
  if (coverageStatuses.gap) errors.push(`${coverageStatuses.gap} mapped Basic controls still have no implemented assistant path`);
  const report = { formatVersion: 1, candidateFiles: candidates.length, candidateControls: known.size, mappedBasicControls: basic.length, excludedControls: excluded.length, unresolvedControls: unresolved.length, mappingPercent: basic.length + unresolved.length ? Math.floor(10000 * basic.length / (basic.length + unresolved.length)) / 100 : 0, surfaceActions: rows.length, modes: Object.fromEntries(['read', 'execute', 'confirm', 'handoff', 'navigate', 'form'].map(mode => [mode, rows.filter(row => row.mode === mode).length])), evidence: { mapping: 'reviewed native source and named regression references', tests: 'reference validation only; execute test suites separately', providerIntegration: 'not certified by this inventory' }, errors, unresolved: unresolved.map(({ id, file, line, tag, opening }) => ({ id, file, line, tag, opening })) };
  report.operationalCoverage = { ...coverageStatuses, supportedControls: coverageStatuses.implemented + coverageStatuses.server_equivalent + coverageStatuses.human_required, functionalCoveragePercent: basic.length + unresolved.length ? Math.floor(10000 * (coverageStatuses.implemented + coverageStatuses.server_equivalent + coverageStatuses.human_required) / (basic.length + unresolved.length)) / 100 : 0, meaning: 'Human-required steps remain explicit; a mapped gap never counts as supported or autonomous.' };
  if (!options.reportOnly && errors.length) throw new Error(`Basic assistant coverage is incomplete:\n${errors.slice(0, 60).join('\n')}`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const inventoryOutput = process.argv.find(arg => arg.startsWith('--inventory='))?.slice('--inventory='.length);
  if (process.argv.includes('--assemble-reviewed')) {
    const review = assembleBasicAssistantSurfaceReview(root);
    writeFileSync(join(root, BASIC_REVIEW_FILE), JSON.stringify(review, null, 2) + '\n');
    console.log(JSON.stringify({ reviewFile: BASIC_REVIEW_FILE, files: Object.keys(review.files).length, evidenceFiles: Object.keys(review.evidenceDigests).length }));
  } else if (inventoryOutput) {
    const candidates = scanBasicSurfaceCandidates(root);
    writeFileSync(resolve(inventoryOutput), JSON.stringify(candidates, null, 2) + '\n');
    console.log(JSON.stringify({ files: candidates.length, controls: candidates.reduce((sum, file) => sum + file.controls.length, 0), inventoryOutput }));
  } else {
    try {
      const result = verifyBasicAssistantCoverage(root, { reportOnly: process.argv.includes('--report') });
      const output = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length);
      if (output) writeFileSync(resolve(output), JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify({ ...result, unresolved: result.unresolved.slice(0, 10), errors: result.errors.slice(0, 30) }, null, 2));
      if (result.errors.length) process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
