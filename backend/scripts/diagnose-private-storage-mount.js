import { readFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertPrivateStorageMount,
  canonicalizePrivateStoragePath,
  findMountForStoragePath,
} from '../src/services/privateStorageMount.js';

const expectedEnvironment = Object.freeze({ nodeEnv: 'production', appEnv: 'staging' });
const expectedStorageDirectory = '/data/private';

function isWithinDirectory(directory, candidate) {
  const relativePath = posix.relative(directory, candidate);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith('../') && !posix.isAbsolute(relativePath));
}

function describeMount(mount) {
  if (!mount) return 'not-found';
  return `mountpoint=${mount.mountPoint}; filesystem=${mount.filesystemType}`;
}

export async function collectPrivateStorageMountDiagnostic({
  environment = process.env,
  platform = process.platform,
  readMountInfo = () => readFile('/proc/self/mountinfo', 'utf8'),
  canonicalizePath = canonicalizePrivateStoragePath,
  assertMount = assertPrivateStorageMount,
} = {}) {
  const targetMatches = environment.NODE_ENV === expectedEnvironment.nodeEnv
    && environment.APP_ENV === expectedEnvironment.appEnv;
  const configuredDirectory = typeof environment.PRIVATE_STORAGE_DIR === 'string'
    ? environment.PRIVATE_STORAGE_DIR.trim()
    : '';
  const configuredDirectoryMatches = Boolean(configuredDirectory)
    && posix.resolve(configuredDirectory) === expectedStorageDirectory;

  const report = {
    targetMatches,
    mountInfoReadable: false,
    dataMount: null,
    canonicalPrivateStoragePath: null,
    privateStorageMount: null,
    configuredDirectoryMatches,
    guard: 'not-run',
    result: 'FAIL',
    reason: '',
  };

  if (!targetMatches) {
    report.reason = 'Run this check only inside the staging API service with production runtime safeguards.';
    return report;
  }

  let mountInfo;
  try {
    mountInfo = await readMountInfo();
    report.mountInfoReadable = true;
  } catch {
    report.guard = 'reject';
    report.reason = 'The container mount metadata could not be read.';
    return report;
  }

  try {
    report.canonicalPrivateStoragePath = await canonicalizePath(expectedStorageDirectory);
  } catch {
    report.guard = 'reject';
    report.reason = 'The expected private storage path could not be canonicalized.';
    return report;
  }

  report.dataMount = findMountForStoragePath('/data', mountInfo);
  report.privateStorageMount = findMountForStoragePath(report.canonicalPrivateStoragePath, mountInfo);

  if (!configuredDirectoryMatches) {
    report.reason = 'The configured storage directory does not match the expected /data/private location.';
  } else if (!isWithinDirectory('/data', report.canonicalPrivateStoragePath)) {
    report.reason = 'The canonical private storage path resolves outside /data.';
  } else if (report.dataMount?.mountPoint !== '/data') {
    report.reason = 'The mount entry containing /data is not a distinct mount at /data.';
  }

  if (platform !== 'linux') {
    report.guard = 'reject';
    report.reason ||= 'The production guard requires a Linux runtime.';
  } else {
    try {
      await assertMount({
        nodeEnv: environment.NODE_ENV,
        directory: configuredDirectory,
        platform,
        readMountInfo: async () => mountInfo,
        canonicalizePath,
      });
      report.guard = 'accept';
    } catch (error) {
      report.guard = 'reject';
      report.reason ||= error?.message || 'The production guard rejected the storage mount.';
    }
  }

  if (!report.reason && report.guard === 'accept') {
    report.result = 'PASS';
    report.reason = 'The expected mount path is present and the production guard accepts the configured storage path.';
  } else if (!report.reason) {
    report.reason = 'The production guard did not accept the configured storage path.';
  }

  return report;
}

export function formatPrivateStorageMountDiagnostic(report) {
  return [
    `target=${report.targetMatches ? 'staging-production-runtime' : 'unexpected-environment'}`,
    `mountinfo=${report.mountInfoReadable ? 'readable' : 'unreadable-or-not-checked'}`,
    `mount_containing_/data=${describeMount(report.dataMount)}`,
    `canonical_path_/data/private=${report.canonicalPrivateStoragePath ?? 'unresolved'}`,
    `storage_mount=${describeMount(report.privateStorageMount)}`,
    `configured_path_matches_expected=${report.configuredDirectoryMatches ? 'yes' : 'no'}`,
    `guard=${report.guard}`,
    `result=${report.result}`,
    `reason=${report.reason}`,
  ].join('\n');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  try {
    const report = await collectPrivateStorageMountDiagnostic();
    console.log(formatPrivateStorageMountDiagnostic(report));
    if (report.result !== 'PASS') process.exitCode = 1;
  } catch {
    console.error('The private storage diagnostic could not complete safely.');
    process.exitCode = 1;
  }
}
