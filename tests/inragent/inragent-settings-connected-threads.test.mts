import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {
  INR_AGENT_PINTEREST_PUBLISH_MIGRATION_FLAG,
  INR_AGENT_X_PUBLISH_MIGRATION_FLAG,
  sanitizeInrAgentSettings,
  sanitizeInrAgentAutomationSettings,
  type InrAgentChannel,
  type InrAgentSettings,
} from '../../lib/inrAgentSettings.ts';

type ConnectionFixture = Record<string, { connected: boolean; requiresUpdate: boolean }>;
const text = readFileSync(new URL('../../app/api/agent/settings/route.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('settings-route.ts', text, ts.ScriptTarget.Latest, true);
const functions = ['connectedInrAgentChannels', 'filterSettingsByConnectedChannels'].map(name => {
  const node = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(node, `Actual settings handler function ${name}`);
  return node.getText(source);
}).join('\n');
const code = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const runtime = new Function('sanitizeInrAgentSettings', 'INR_AGENT_PINTEREST_PUBLISH_MIGRATION_FLAG', 'INR_AGENT_X_PUBLISH_MIGRATION_FLAG',
  code + '\nreturn { connectedInrAgentChannels, filterSettingsByConnectedChannels };')(
  sanitizeInrAgentSettings, INR_AGENT_PINTEREST_PUBLISH_MIGRATION_FLAG, INR_AGENT_X_PUBLISH_MIGRATION_FLAG,
) as {
  connectedInrAgentChannels(states: ConnectionFixture, inrSearchPublished?: boolean): Set<InrAgentChannel>;
  filterSettingsByConnectedChannels(settings: InrAgentSettings, channels: Set<InrAgentChannel>, options: { hydrateMissingPublishDefaults: boolean }): InrAgentSettings;
};
function states(): ConnectionFixture {
  return Object.fromEntries(['site_web', 'gmb', 'facebook', 'instagram', 'threads', 'linkedin', 'x', 'tiktok', 'youtube_shorts', 'pinterest', 'mails']
    .map(channel => [channel, { connected: false, requiresUpdate: false }]));
}
function selectedThreads(): InrAgentSettings {
  const defaults = sanitizeInrAgentSettings(null);
  return sanitizeInrAgentSettings({ ...defaults, globalEnabled: true, automations: { ...defaults.automations, publish: sanitizeInrAgentAutomationSettings('publish', {
    enabled: true, allowedChannels: ['threads'], frequency: 'daily', validationMode: 'admin_automatic_publish', metadata: { inrSearchChannelAdded: true },
  }) } });
}

test('healthy selected Threads survives the settings connection filter and preserves other connected channels', () => {
  const connections = states();
  connections.threads.connected = true;
  connections.facebook.connected = true;
  const connected = runtime.connectedInrAgentChannels(connections, true);
  assert.deepEqual([...connected].sort(), ['facebook', 'inr_search', 'threads']);
  const filtered = runtime.filterSettingsByConnectedChannels(selectedThreads(), connected, { hydrateMissingPublishDefaults: false });
  assert.deepEqual(filtered.automations.publish.allowedChannels, ['threads']);
  assert.equal(filtered.automations.publish.enabled, true);
  assert.equal(filtered.globalEnabled, true);
});

test('Threads requiring reconnection cannot remain selected or keep an otherwise disconnected automation enabled', () => {
  const connections = states();
  connections.threads = { connected: true, requiresUpdate: true };
  const connected = runtime.connectedInrAgentChannels(connections);
  assert.equal(connected.has('threads'), false);
  const filtered = runtime.filterSettingsByConnectedChannels(selectedThreads(), connected, { hydrateMissingPublishDefaults: false });
  assert.deepEqual(filtered.automations.publish.allowedChannels, []);
  assert.equal(filtered.automations.publish.enabled, false);
  assert.equal(filtered.globalEnabled, false);
});

test('disconnected or pilot-disabled Threads state does not enable publication', () => {
  const connected = runtime.connectedInrAgentChannels(states());
  assert.equal(connected.has('threads'), false);
  const filtered = runtime.filterSettingsByConnectedChannels(selectedThreads(), connected, { hydrateMissingPublishDefaults: false });
  assert.equal(filtered.automations.publish.enabled, false);
});
