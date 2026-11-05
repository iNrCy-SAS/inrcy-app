import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalInrAssistantPublicLinkTarget, getInrAssistantNativeChannelLinksSnapshot, isNativePublicChannelHref, registerInrAssistantNativeChannelLink, requestInrAssistantNativeChannelLink as nativeRequest, type InrAssistantNativeChannelLink } from '../../lib/inrAssistantNativeChannelLinks.ts';
import { parseInrAssistantLocalInterfaceCommand, isInrAssistantLocalInterfaceRequest, isInrAssistantLocalInterfaceValueRequested } from '../../lib/inrAssistantLocalInterface.ts';
import { inrAssistantUiSuccessStatus } from '../../lib/inrAssistantUiActions.ts';

const requestInrAssistantNativeChannelLink = (...args: Parameters<typeof nativeRequest> extends [...infer A, unknown] ? A : never) => nativeRequest(...args, getInrAssistantNativeChannelLinksSnapshot());
const scope = { actorUserId: 'actor', accountId: 'account', pathname: '/dashboard' };
test('Public channel links use only scoped rendered native targets and never a model URL', () => {
  let calls = 0;
  const entry: InrAssistantNativeChannelLink = { ...scope, kind: 'public', target: 'facebook', identity: 'https://facebook.com/owned', state: {}, blocked: false, invoke: () => { calls++; }, matches: () => true };
  registerInrAssistantNativeChannelLink('publicA', entry);
  try {
    assert.throws(() => requestInrAssistantNativeChannelLink(scope, 'public', 'https://evil.example', 'open', () => true));
    assert.throws(() => requestInrAssistantNativeChannelLink({ ...scope, accountId: 'other' }, 'public', 'facebook', 'open', () => true));
    assert.throws(() => requestInrAssistantNativeChannelLink({ ...scope, actorUserId: 'other' }, 'public', 'facebook', 'open', () => true));
    assert.throws(() => requestInrAssistantNativeChannelLink(scope, 'public', 'facebook', 'open', () => false));
    assert.equal(calls, 0);
    const before = getInrAssistantNativeChannelLinksSnapshot();
    registerInrAssistantNativeChannelLink('publicA', { ...entry, state: { changed: true } });
    assert.throws(() => nativeRequest(scope, 'public', 'facebook', 'open', () => true, before)); assert.equal(calls, 0, 'an old bridge cannot act on a newly committed native draft');
    const receipt = requestInrAssistantNativeChannelLink(scope, 'public', 'facebook', 'open', () => true);
    assert.equal(calls, 1); assert.equal(receipt.matches(getInrAssistantNativeChannelLinksSnapshot()), true);
    registerInrAssistantNativeChannelLink('publicA', { ...entry, identity: 'https://facebook.com/changed' });
    assert.equal(receipt.matches(getInrAssistantNativeChannelLinksSnapshot()), false);
  } finally { registerInrAssistantNativeChannelLink('publicA', null); }
});

test('Responsive copies may share one exact public destination while different links and duplicate editors fail closed', () => {
  let calls = 0;
  const entry: InrAssistantNativeChannelLink = { ...scope, kind: 'public', target: 'facebook', identity: 'native-same-link', state: {}, blocked: false, invoke: () => { calls++; }, matches: () => true };
  try {
    registerInrAssistantNativeChannelLink('publicA', entry); registerInrAssistantNativeChannelLink('publicB', entry);
    requestInrAssistantNativeChannelLink(scope, 'public', 'facebook', 'open', () => true); assert.equal(calls, 1);
    registerInrAssistantNativeChannelLink('publicB', { ...entry, identity: 'different' });
    assert.throws(() => requestInrAssistantNativeChannelLink(scope, 'public', 'facebook', 'open', () => true)); assert.equal(calls, 1);
    registerInrAssistantNativeChannelLink('publicA', { ...entry, kind: 'editor' }); registerInrAssistantNativeChannelLink('publicB', { ...entry, kind: 'editor' });
    assert.throws(() => requestInrAssistantNativeChannelLink(scope, 'editor', 'facebook', 'open', () => true));
  } finally { registerInrAssistantNativeChannelLink('publicA', null); registerInrAssistantNativeChannelLink('publicB', null); }
});

test('Link controls bind channel names to their exact native target and report only a browser handoff', () => {
  assert.equal(canonicalInrAssistantPublicLinkTarget('linkedin', 'profile'), 'linkedin_profile'); assert.equal(canonicalInrAssistantPublicLinkTarget('inrBadge'), 'inr_badge');
  for (const href of ['javascript:alert(1)', 'data:text/html,hello', 'https://user:pass@example.com/', '/api/private']) assert.equal(isNativePublicChannelHref(href), false);
  assert.equal(isNativePublicChannelHref('https://facebook.com/owned'), true);
  const command = { command: 'control_local_interface' as const, selection: { kind: 'account_document' as const, id: 'public_channel_link' as const }, operation: 'open' as const, value: 'facebook', revision: 'native_v1' };
  assert.deepEqual(parseInrAssistantLocalInterfaceCommand(command), command);
  assert.equal(parseInrAssistantLocalInterfaceCommand({ ...command, value: 'https://evil.example' }), null);
  assert.equal(isInrAssistantLocalInterfaceRequest('Ouvre ma page Facebook.', 'public_channel_link', 'open'), true);
  assert.equal(isInrAssistantLocalInterfaceValueRequested('Ouvre ma page Facebook.', 'public_channel_link', 'open', 'instagram'), false);
  assert.equal(isInrAssistantLocalInterfaceValueRequested('Ouvre le profil LinkedIn personnel public.', 'public_channel_link', 'open', 'linkedin_organization'), false);
  assert.equal(inrAssistantUiSuccessStatus({ id: 'open_public', type: 'command', command }), 'handed_to_browser');
});
