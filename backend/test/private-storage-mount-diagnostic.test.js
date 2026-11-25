import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectPrivateStorageMountDiagnostic,
  formatPrivateStorageMountDiagnostic,
} from '../scripts/diagnose-private-storage-mount.js';

const rootMount = '1 0 0:1 / / rw - overlay overlay rw\n';
const dataVolume = `${rootMount}2 1 8:1 / /data rw - ext4 /dev/volume rw\n`;
const stagingEnvironment = {
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  PRIVATE_STORAGE_DIR: '/data/private',
};

test('diagnostic reports a matching /data volume and accepted storage guard without printing environment values', async () => {
  const report = await collectPrivateStorageMountDiagnostic({
    environment: stagingEnvironment,
    platform: 'linux',
    readMountInfo: async () => dataVolume,
    canonicalizePath: async (value) => value,
  });
  const output = formatPrivateStorageMountDiagnostic(report);

  assert.equal(report.result, 'PASS');
  assert.equal(report.dataMount.mountPoint, '/data');
  assert.equal(report.dataMount.filesystemType, 'ext4');
  assert.equal(report.canonicalPrivateStoragePath, '/data/private');
  assert.equal(report.guard, 'accept');
  assert.match(output, /mount_containing_\/data=mountpoint=\/data; filesystem=ext4/u);
  assert.match(output, /result=PASS/u);
  assert.doesNotMatch(output, /PRIVATE_STORAGE_DIR|mongodb|SESSION_SECRET|RAZORPAY|RESEND_API_KEY/u);
});

test('diagnostic explains when the volume mount is missing and the guard rejects root storage', async () => {
  const report = await collectPrivateStorageMountDiagnostic({
    environment: stagingEnvironment,
    platform: 'linux',
    readMountInfo: async () => rootMount,
    canonicalizePath: async (value) => value,
  });
  const output = formatPrivateStorageMountDiagnostic(report);

  assert.equal(report.dataMount.mountPoint, '/');
  assert.equal(report.guard, 'reject');
  assert.equal(report.result, 'FAIL');
  assert.match(report.reason, /distinct mount at \/data/u);
  assert.match(output, /result=FAIL/u);
});

test('diagnostic explains guard rejection for an ephemeral nested filesystem', async () => {
  const ephemeralData = `${rootMount}2 1 0:2 / /data rw - tmpfs none rw\n`;
  const report = await collectPrivateStorageMountDiagnostic({
    environment: stagingEnvironment,
    platform: 'linux',
    readMountInfo: async () => ephemeralData,
    canonicalizePath: async (value) => value,
  });

  assert.equal(report.guard, 'reject');
  assert.equal(report.result, 'FAIL');
  assert.match(report.reason, /separate non-ephemeral mount/u);
});

test('diagnostic fails without reading mount metadata outside the intended staging runtime', async () => {
  let readAttempted = false;
  const report = await collectPrivateStorageMountDiagnostic({
    environment: { ...stagingEnvironment, APP_ENV: 'production' },
    readMountInfo: async () => { readAttempted = true; return dataVolume; },
  });

  assert.equal(readAttempted, false);
  assert.equal(report.result, 'FAIL');
  assert.match(report.reason, /only inside the staging API service/u);
});

test('diagnostic reports unreadable mount metadata without exposing error details', async () => {
  const report = await collectPrivateStorageMountDiagnostic({
    environment: stagingEnvironment,
    platform: 'linux',
    readMountInfo: async () => { throw new Error('private runtime detail'); },
  });
  const output = formatPrivateStorageMountDiagnostic(report);

  assert.equal(report.mountInfoReadable, false);
  assert.equal(report.result, 'FAIL');
  assert.match(report.reason, /mount metadata could not be read/u);
  assert.doesNotMatch(output, /private runtime detail/u);
});

test('diagnostic does not reveal a mismatched configured storage path', async () => {
  const secretLookingPath = '/srv/tenant-private-data';
  const report = await collectPrivateStorageMountDiagnostic({
    environment: { ...stagingEnvironment, PRIVATE_STORAGE_DIR: secretLookingPath },
    platform: 'linux',
    readMountInfo: async () => dataVolume,
    canonicalizePath: async (value) => value,
  });
  const output = formatPrivateStorageMountDiagnostic(report);

  assert.equal(report.configuredDirectoryMatches, false);
  assert.equal(report.result, 'FAIL');
  assert.match(report.reason, /does not match the expected \/data\/private/u);
  assert.doesNotMatch(output, new RegExp(secretLookingPath.replaceAll('/', '\\/'), 'u'));
});
