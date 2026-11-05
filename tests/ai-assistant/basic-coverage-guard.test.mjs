import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { assembleBasicAssistantSurfaceReview, basicCoverageReviewInventory, collectBasicLocalEvidenceFiles, namedBasicRegressionExists, scanBasicSurfaceCandidates, verifyBasicAssistantCoverage } from '../../scripts/assistant-basic-coverage.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'inrcy-basic-coverage-'));
  const put = (file, value) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), typeof value === 'string' ? value : JSON.stringify(value)); };
  try {
    put('app/dashboard/page.tsx', 'export default function Page(){return <button onClick={openStats}>Stats</button>}');
    put('lib/inrAssistantActionCoverage.ts', 'export const INR_ASSISTANT_ACTION_COVERAGE=[{id:"stats.view",editions:["basic"],availability:"implemented",tools:["runScreenCommand"]}];');
    put('tests/stats.test.mts', 'test("native Stats changes only after rendered ACK",()=>{});');
    const candidates = scanBasicSurfaceCandidates(root), rows = [{ id: 'stats.open', label: 'Ouvrir Stats', domain: 'stats', capabilityId: 'stats.view', mode: 'execute', coverageStatus: 'implemented', toolNames: ['runScreenCommand'], sourceFiles: ['app/dashboard/page.tsx'], sourceAnchor: 'onClick={openStats}', testFiles: ['tests/stats.test.mts'], testAnchor: 'native Stats changes only after rendered ACK', controlIds: [candidates[0].controls[0].id], notes: 'Acknowledge only actual render.' }];
    put('scripts/assistant-basic-surfaces-account.json', []); put('scripts/assistant-basic-surfaces-media.json', rows); put('scripts/assistant-basic-surfaces-shell.json', []); put('scripts/assistant-basic-surfaces-history-plan.json', []);
    put('scripts/assistant-basic-file-scope-account.json', {}); put('scripts/assistant-basic-file-scope-media.json', { 'app/dashboard/page.tsx': { disposition: 'basic', reason: 'Basic native Stats entry.' } }); put('scripts/assistant-basic-file-scope-shell.json', {}); put('scripts/assistant-basic-file-scope-history-plan.json', {});
    const review = basicCoverageReviewInventory(root, candidates, rows, { 'app/dashboard/page.tsx': { disposition: 'basic', reason: 'Basic native Stats entry.' } });
    put('scripts/assistant-basic-surface-reviews.json', review);
    run({ root, put, rows, review });
  } finally {
    const target = resolve(root), insideTemp = relative(resolve(tmpdir()), target);
    assert.ok(insideTemp && !insideTemp.startsWith('..') && !isAbsolute(insideTemp) && insideTemp.startsWith('inrcy-basic-coverage-'));
    rmSync(target, { recursive: true, force: true });
  }
}
test('Basic coverage guard accepts a reviewed complete mapping without certifying a real provider integration', () => fixture(({ root }) => {
  const result = verifyBasicAssistantCoverage(root); assert.equal(result.mappingPercent, 100); assert.equal(result.mappedBasicControls, 1); assert.equal(result.unresolvedControls, 0); assert.match(result.evidence.providerIntegration, /not certified/);
}));
test('Basic coverage guard rejects a new button, changed native handler, new route and deleted named proof', () => {
  for (const change of ['button', 'handler', 'route', 'proof', 'editable']) fixture(({ root, put }) => {
    if (change === 'button') put('app/dashboard/page.tsx', readFileSync(join(root, 'app/dashboard/page.tsx'), 'utf8').replace('</button>', '</button><button onClick={publish}>Publier</button>'));
    if (change === 'handler') put('app/dashboard/page.tsx', 'export default function Page(){return <button onClick={sendMail}>Stats</button>}');
    if (change === 'route') put('app/dashboard/new/page.tsx', 'export default function Page(){return <input onChange={save}/> }');
    if (change === 'proof') put('tests/stats.test.mts', '// native Stats changes only after rendered ACK\ntest.skip("native Stats changes only after rendered ACK",()=>{});');
    if (change === 'editable') put('app/dashboard/editor/page.tsx', 'export default function Editor(){return <div role="textbox" contentEditable onInput={edit} onPaste={paste}/> }');
    assert.throws(() => verifyBasicAssistantCoverage(root), /incomplete/, change);
  });
});
test('Basic coverage guard rejects hidden exclusions, missing personal-step reasons and paid capabilities', () => {
  fixture(({ root, put, review }) => { review.files['app/dashboard/page.tsx'].disposition = 'out_of_pack'; put('scripts/assistant-basic-surface-reviews.json', review); assert.throws(() => verifyBasicAssistantCoverage(root), /no current access gate/); });
  fixture(({ root, put, rows }) => { rows[0].mode = 'handoff'; put('scripts/assistant-basic-surfaces-media.json', rows); assert.throws(() => verifyBasicAssistantCoverage(root), /human step needs/); });
  fixture(({ root, put }) => { put('lib/inrAssistantActionCoverage.ts', 'export const INR_ASSISTANT_ACTION_COVERAGE=[{id:"stats.view",editions:["premium"],availability:"implemented",tools:["runScreenCommand"]}];'); assert.throws(() => verifyBasicAssistantCoverage(root), /not available to Basic/); });
});
test('Basic regression evidence requires an actual named active test rather than a comment or filename', () => {
  assert.equal(namedBasicRegressionExists('// test("proof",()=>{})', 'proof'), false);
  assert.equal(namedBasicRegressionExists('test.skip("proof",()=>{})', 'proof'), false);
  assert.equal(namedBasicRegressionExists('test("proof",{skip:true},()=>{})', 'proof'), false);
  assert.equal(namedBasicRegressionExists('describe.skip("group",()=>{test("proof",()=>{})})', 'proof'), false);
  assert.equal(namedBasicRegressionExists('test("proof",{skip:false},()=>{})', 'proof'), true);
  assert.equal(namedBasicRegressionExists('test("proof",()=>{})', 'proof'), true);
});

test('Basic additional regression proofs require active named tests and include their transitive native helpers in review hashes', () => {
  for (const change of ['body', 'skip', 'missing']) fixture(({ root, put, rows, review }) => {
    rows[0].additionalProofs = [{ file: 'tests/additional.test.mts', testAnchor: 'additional native scope regression' }];
    put('tests/additional.test.mts', 'import "./helpers/additional-helper"; test("additional native scope regression",()=>{});');
    put('tests/helpers/additional-helper.ts', 'export { nativeScope } from "../../lib/additional-helper";');
    put('lib/additional-helper.ts', 'export const nativeScope = 1;');
    put('scripts/assistant-basic-surfaces-media.json', rows);
    const updated = basicCoverageReviewInventory(root, scanBasicSurfaceCandidates(root), rows, review.files);
    assert.ok(updated.evidenceDigests['tests/additional.test.mts']); assert.ok(updated.evidenceDigests['tests/helpers/additional-helper.ts']); assert.ok(updated.evidenceDigests['lib/additional-helper.ts']);
    put('scripts/assistant-basic-surface-reviews.json', updated); verifyBasicAssistantCoverage(root);
    if (change === 'body') put('lib/additional-helper.ts', 'export const nativeScope = 2;');
    if (change === 'skip') put('tests/additional.test.mts', 'test.skip("additional native scope regression",()=>{});');
    if (change === 'missing') put('tests/additional.test.mts', '// additional native scope regression');
    assert.throws(() => verifyBasicAssistantCoverage(root), change === 'body' ? /proof bodies changed/ : /additional named regression proof is stale/);
  });
});

test('A complete mapping cannot certify an unimplemented button and proof body changes invalidate the review', () => {
  fixture(({ root, put, rows, review }) => {
    rows[0].coverageStatus = 'gap'; put('scripts/assistant-basic-surfaces-media.json', rows);
    const updated = basicCoverageReviewInventory(root, scanBasicSurfaceCandidates(root), rows, review.files);
    put('scripts/assistant-basic-surface-reviews.json', updated);
    const result = verifyBasicAssistantCoverage(root, { reportOnly: true });
    assert.equal(result.mappingPercent, 100); assert.equal(result.operationalCoverage.functionalCoveragePercent, 0);
    assert.throws(() => verifyBasicAssistantCoverage(root), /no implemented assistant path/);
  });
  fixture(({ root, put }) => {
    put('tests/stats.test.mts', 'test("native Stats changes only after rendered ACK",()=>{ throw new Error("changed"); });');
    assert.throws(() => verifyBasicAssistantCoverage(root), /proof bodies changed/);
  });
});

test('Basic evidence follows transitive native source proof gate and route imports including literal dynamic and JS-to-TS resolution', () => fixture(({ root, put, rows, review }) => {
  put('app/dashboard/page.tsx', 'import {native} from "@/lib/native.js"; export default function Page(){return <button onClick={openStats}>Stats</button>}');
  put('lib/native.ts', 'export {value} from "./nested/value";'); put('lib/nested/value.ts', 'export const value=1;');
  put('tests/stats.test.mts', 'import "../lib/proof-native"; test("native Stats changes only after rendered ACK",()=>{});'); put('lib/proof-native.ts', 'export const proofNative=1;');
  put('lib/edition-gate.ts', 'export const allowed = true; import "./nested/gate-leaf";'); put('lib/nested/gate-leaf.ts', 'export const role="owner";');
  put('lib/inrAssistantActionCoverage.ts', 'export const INR_ASSISTANT_ACTION_COVERAGE=[{id:"stats.view",editions:["basic"],availability:"implemented",tools:["runScreenCommand"],nativeRoutes:["/api/native"]}];');
  put('app/api/native/route.ts', 'export async function GET(){return import("@/lib/route-native");}'); put('lib/route-native.ts', 'export const routeNative=1;');
  const files = { ...review.files, 'app/dashboard/page.tsx': { ...review.files['app/dashboard/page.tsx'], gateFiles: ['lib/edition-gate.ts'], gateAnchor: 'export const allowed = true;' } };
  const updated = basicCoverageReviewInventory(root, scanBasicSurfaceCandidates(root), rows, files); put('scripts/assistant-basic-surface-reviews.json', updated);
  for (const file of ['lib/native.ts', 'lib/nested/value.ts', 'lib/proof-native.ts', 'lib/nested/gate-leaf.ts', 'app/api/native/route.ts', 'lib/route-native.ts']) assert.ok(updated.evidenceDigests[file], file);
  assert.ok(!collectBasicLocalEvidenceFiles(root, ['app/dashboard/page.tsx']).includes('../outside.ts'));
  verifyBasicAssistantCoverage(root);
  put('lib/nested/value.ts', 'export const value=2;'); assert.throws(() => verifyBasicAssistantCoverage(root), /Native executors, gates or named proof bodies changed/);
}));

test('Basic manual review assembly merges four frozen owners and refuses duplicate ownership or an unreviewed native surface', () => fixture(({ root, put }) => {
  const assembled = assembleBasicAssistantSurfaceReview(root); assert.equal(assembled.formatVersion, 3); assert.equal(Object.keys(assembled.files).length, 1);
  put('scripts/assistant-basic-file-scope-account.json', { 'app/dashboard/page.tsx': { disposition: 'basic', reason: 'A second owner cannot silently win.' } }); assert.throws(() => assembleBasicAssistantSurfaceReview(root), /Multiple owners/);
  put('scripts/assistant-basic-file-scope-account.json', {}); put('app/dashboard/new/page.tsx', 'export default function Page(){return <button onClick={unknown}>New</button>}'); assert.throws(() => assembleBasicAssistantSurfaceReview(root), /Missing explicit file-scope decision/);
}));

test('An unmounted component exclusion rescans all app/lib imports render uses and Next conventions instead of trusting its declaration anchor', () => {
  for (const use of ['none', 'import', 'barrel', 'dynamic', 'require', 'jsx', 'createElement', 'route']) fixture(({ root, put, rows, review }) => {
    const file = use === 'route' ? 'app/dashboard/unused/page.tsx' : 'app/dashboard/_components/Dormant.tsx';
    put(file, 'export default function Dormant(){return <button onClick={configure}>Configure</button>}');
    const files = { ...review.files, [file]: { disposition: 'infrastructure', reason: 'Unused component, rechecked structurally.', gateFiles: [file], gateAnchor: 'export default function Dormant()', structuralProof: { kind: 'unmounted_component', exportName: 'Dormant' } } };
    put('scripts/assistant-basic-surface-reviews.json', basicCoverageReviewInventory(root, scanBasicSurfaceCandidates(root), rows, files));
    if (use === 'import') put('app/consumer.ts', 'import View from "./dashboard/_components/Dormant"; export const view=View;');
    if (use === 'barrel') put('lib/barrel.ts', 'export {default as View} from "@/app/dashboard/_components/Dormant";');
    if (use === 'dynamic') put('app/consumer.ts', 'export const view=()=>import("./dashboard/_components/"+"Dormant");');
    if (use === 'require') put('lib/consumer.ts', 'export const view=require("../app/dashboard/_components/Dormant");');
    if (use === 'jsx') put('app/consumer.tsx', 'export const view=<Dormant/>;');
    if (use === 'createElement') put('lib/consumer.ts', 'export const view=React.createElement(Dormant,{});');
    if (use === 'none') { const result=verifyBasicAssistantCoverage(root); assert.equal(result.excludedControls,1); }
    else assert.throws(() => verifyBasicAssistantCoverage(root), /current app\/lib import or render use|conventional Next route entry/, use);
  });
});
