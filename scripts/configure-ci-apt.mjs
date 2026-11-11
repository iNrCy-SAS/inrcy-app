import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UBUNTU_CI_MIRRORS = [
  'https://archive.ubuntu.com/ubuntu',
  'https://azure.archive.ubuntu.com/ubuntu',
  'https://mirrors.edge.kernel.org/ubuntu',
];

export async function selectUbuntuCiMirror(probe, mirrors = UBUNTU_CI_MIRRORS) {
  for (const mirror of mirrors) {
    // Both release and security metadata must be reachable from this runner.
    const available = await Promise.all(['noble', 'noble-security'].map(async suite => {
      try { return await probe(`${mirror}/dists/${suite}/InRelease`); }
      catch { return false; }
    }));
    if (available.every(Boolean)) return mirror;
  }
  throw new Error('No Ubuntu mirror serves both Noble and security metadata from this runner.');
}

export function ubuntuCiSources(source, mirror) {
  if (!UBUNTU_CI_MIRRORS.includes(mirror)) throw new Error('Unreviewed Ubuntu mirror');
  if (!/^URIs:/m.test(source) || !/^Signed-By:\s*\/usr\/share\/keyrings\/ubuntu-archive-keyring\.gpg\s*$/m.test(source)) {
    throw new Error('Expected signed Ubuntu deb822 source configuration');
  }
  // Keep the suites, components, architectures and Ubuntu signing key intact.
  return source.replace(/^URIs:.*$/gm, `URIs: ${mirror}`);
}

async function metadataAvailable(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  return response.ok && (await response.text()).startsWith('-----BEGIN PGP SIGNED MESSAGE-----');
}

function sudo(args, input) {
  const result = spawnSync('sudo', args, {
    ...(input === undefined ? { stdio: 'inherit' } : { input, encoding: 'utf8', stdio: ['pipe', 'ignore', 'inherit'] }),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`CI APT command failed (${result.status}): ${args[0]}`);
}

async function configureCiApt() {
  if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('APT preparation is limited to the GitHub Actions Linux runner.');
  }
  const sourcesPath = '/etc/apt/sources.list.d/ubuntu.sources';
  const source = readFileSync(sourcesPath, 'utf8');
  const mirror = await selectUbuntuCiMirror(metadataAvailable);
  console.log(`[ci:apt] Using verified reachable mirror ${mirror}`);
  sudo(['tee', sourcesPath], ubuntuCiSources(source, mirror));
  sudo(['tee', '/etc/apt/apt.conf.d/zzzz-ci-network'], [
    'Acquire::Retries "1";',
    'Acquire::http::Timeout "20";',
    'Acquire::https::Timeout "20";',
    'Acquire::ForceIPv4 "true";',
    '',
  ].join('\n'));
  // Fail here on stale/missing repository metadata, before Playwright spends
  // its entire installation timeout trying to download packages from it.
  sudo(['timeout', '90s', 'apt-get', '-o', 'APT::Update::Error-Mode=any', 'update']);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await configureCiApt();
}
