import { readFile, realpath } from 'node:fs/promises';
import { posix } from 'node:path';

const knownEphemeralFileSystems = new Set(['overlay', 'tmpfs', 'ramfs', 'devtmpfs']);

function decodeMountInfoPath(value) {
  return value.replace(/\\([0-7]{3})/gu, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
}

function isWithinMount(mountPoint, targetPath) {
  const relativePath = posix.relative(mountPoint, targetPath);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith('../') && !posix.isAbsolute(relativePath));
}

export async function canonicalizePrivateStoragePath(directory) {
  let current = posix.resolve(directory);
  const missingSegments = [];
  while (true) {
    try {
      const existingPath = await realpath(current);
      return posix.resolve(existingPath, ...missingSegments.reverse());
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error?.code)) throw error;
      const parent = posix.dirname(current);
      if (parent === current) throw error;
      missingSegments.unshift(posix.basename(current));
      current = parent;
    }
  }
}

export function findMountForStoragePath(storageDirectory, mountInfo) {
  if (typeof storageDirectory !== 'string' || !posix.isAbsolute(storageDirectory) || typeof mountInfo !== 'string') return null;
  const targetPath = posix.normalize(storageDirectory);
  const candidates = [];

  for (const line of mountInfo.split('\n')) {
    const separator = line.indexOf(' - ');
    if (separator < 0) continue;
    const mountFields = line.slice(0, separator).trim().split(/\s+/u);
    const filesystemFields = line.slice(separator + 3).trim().split(/\s+/u);
    if (mountFields.length < 5 || !filesystemFields[0]) continue;

    const mountPoint = posix.normalize(decodeMountInfoPath(mountFields[4]));
    if (!posix.isAbsolute(mountPoint) || !isWithinMount(mountPoint, targetPath)) continue;
    candidates.push({ mountPoint, filesystemType: filesystemFields[0].toLowerCase() });
  }

  candidates.sort((left, right) => right.mountPoint.length - left.mountPoint.length);
  return candidates[0] ?? null;
}

/**
 * In production, require the configured private storage path to sit below a
 * separate Linux mount. This detects the common missing-volume case where the
 * path would otherwise be created on the container root filesystem. It does
 * not prove that the mount is provider-managed or durable; that still needs an
 * owner-side hosting check.
 */
export async function assertPrivateStorageMount({
  nodeEnv,
  directory,
  platform = process.platform,
  readMountInfo = () => readFile('/proc/self/mountinfo', 'utf8'),
  canonicalizePath = canonicalizePrivateStoragePath,
} = {}) {
  if (nodeEnv !== 'production') return;
  if (platform !== 'linux' || typeof directory !== 'string' || !posix.isAbsolute(directory)) {
    throw new Error('Private file storage must be configured beneath a mounted volume in production.');
  }

  let mountInfo;
  try {
    mountInfo = await readMountInfo();
  } catch {
    throw new Error('Private file storage mount could not be verified in production.');
  }

  let canonicalDirectory;
  try {
    canonicalDirectory = await canonicalizePath(directory);
  } catch {
    throw new Error('Private file storage path could not be verified in production.');
  }

  const mount = findMountForStoragePath(canonicalDirectory, mountInfo);
  if (!mount || mount.mountPoint === '/' || knownEphemeralFileSystems.has(mount.filesystemType)) {
    throw new Error('PRIVATE_STORAGE_DIR must be beneath a separate non-ephemeral mount in production.');
  }
}
