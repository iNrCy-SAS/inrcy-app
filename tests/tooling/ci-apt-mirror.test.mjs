import assert from 'node:assert/strict';
import test from 'node:test';
import { selectUbuntuCiMirror, ubuntuCiSources, UBUNTU_CI_MIRRORS } from '../../scripts/configure-ci-apt.mjs';

test('CI selects a reachable mirror after DNS failure and refuses one missing security metadata', async () => {
  const probes = [];
  const chosen = await selectUbuntuCiMirror(async url => {
    probes.push(url);
    if (url.startsWith(UBUNTU_CI_MIRRORS[0] + '/')) throw new Error('DNS resolution failed');
    if (url.startsWith(UBUNTU_CI_MIRRORS[1] + '/')) return !url.includes('noble-security');
    return true;
  });
  assert.equal(chosen, UBUNTU_CI_MIRRORS[2]);
  assert.equal(probes.length, 6);
  assert.ok(probes.every(url => url.startsWith('https://')));
});

test('CI refuses installation when no mirror supplies both signed metadata endpoints', async () => {
  await assert.rejects(selectUbuntuCiMirror(async () => false), /No Ubuntu mirror/);
});

test('CI replaces only Ubuntu URIs and retains suites, components and the signing key', () => {
  const source = 'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-backports\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nTypes: deb\nURIs: http://security.ubuntu.com/ubuntu\nSuites: noble-security\nComponents: main\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n';
  const result = ubuntuCiSources(source, UBUNTU_CI_MIRRORS[2]);
  assert.deepEqual(result.split('\n').filter(line => !line.startsWith('URIs:')), source.split('\n').filter(line => !line.startsWith('URIs:')));
  assert.equal(result.split('\n').filter(line => line === `URIs: ${UBUNTU_CI_MIRRORS[2]}`).length, 2);
  assert.throws(() => ubuntuCiSources(source, 'https://unreviewed.invalid/ubuntu'), /Unreviewed/);
  assert.throws(() => ubuntuCiSources(source.replaceAll('Signed-By:', 'Missing-Key:'), UBUNTU_CI_MIRRORS[0]), /signed Ubuntu/);
});
