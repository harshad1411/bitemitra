// Minimal semantic-version helpers for app version policy (CONFIGURATION.md §6).

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number, prerelease: string | null } | null}
 */
export function parseVersion(version) {
  if (typeof version !== 'string') return null;
  const m = SEMVER.exec(version.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? null };
}

export const isValidVersion = (/** @type {string} */ v) => parseVersion(v) !== null;

/**
 * Compare two versions: negative if a < b, 0 if equal, positive if a > b.
 * A pre-release sorts before its release (1.2.0-beta < 1.2.0). Throws on invalid input.
 * @param {string} a
 * @param {string} b
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`Invalid version: ${!pa ? a : b}`);
  for (const k of /** @type {const} */ (['major', 'minor', 'patch'])) {
    if (pa[k] !== pb[k]) return pa[k] - pb[k];
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

/**
 * Version status for a client (CONFIGURATION.md §6). Unknown or unparsable client versions are
 * treated as UPDATE_REQUIRED so an unidentifiable build can never bypass a forced update.
 * @param {string | null | undefined} clientVersion
 * @param {{ minSupportedVersion: string, recommendedVersion: string, forceUpdate: boolean }} policy
 * @returns {'OK' | 'UPDATE_RECOMMENDED' | 'UPDATE_REQUIRED'}
 */
export function versionStatus(clientVersion, policy) {
  if (!clientVersion || !isValidVersion(clientVersion)) return 'UPDATE_REQUIRED';
  if (compareVersions(clientVersion, policy.minSupportedVersion) < 0) return 'UPDATE_REQUIRED';
  if (compareVersions(clientVersion, policy.recommendedVersion) < 0) {
    return policy.forceUpdate ? 'UPDATE_REQUIRED' : 'UPDATE_RECOMMENDED';
  }
  return 'OK';
}
