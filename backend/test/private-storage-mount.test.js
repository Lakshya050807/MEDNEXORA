import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPrivateStorageMount, findMountForStoragePath } from '../src/services/privateStorageMount.js';

const rootOnly = '1 0 0:1 / / rw,relatime - overlay overlay rw\n';
const mountedData = `${rootOnly}2 1 8:1 / /data rw,relatime - ext4 /dev/volume rw\n`;

test('storage path selects the deepest containing mount rather than a prefix collision', () => {
  assert.deepEqual(findMountForStoragePath('/data/private/files', `${mountedData}3 2 8:2 / /data/private rw - xfs /dev/files rw\n`), {
    mountPoint: '/data/private',
    filesystemType: 'xfs',
  });
  assert.deepEqual(findMountForStoragePath('/data-private/files', mountedData), {
    mountPoint: '/',
    filesystemType: 'overlay',
  });
});

test('mountinfo escaped path characters are decoded before matching', () => {
  const escapedMount = `${rootOnly}2 1 8:1 / /mnt/private\\040volume rw - ext4 /dev/volume rw\n`;
  assert.deepEqual(findMountForStoragePath('/mnt/private volume/pdfs', escapedMount), {
    mountPoint: '/mnt/private volume',
    filesystemType: 'ext4',
  });
});

test('production storage requires a separate non-ephemeral mount', async () => {
  await assert.rejects(assertPrivateStorageMount({
    nodeEnv: 'production',
    directory: '/data/private',
    platform: 'linux',
    readMountInfo: async () => rootOnly,
    canonicalizePath: async (value) => value,
  }), /separate non-ephemeral mount/u);

  for (const filesystemType of ['overlay', 'tmpfs', 'ramfs', 'devtmpfs']) {
    const mountInfo = `1 0 0:1 / / rw - ext4 /dev/root rw\n2 1 0:2 / /data rw - ${filesystemType} none rw\n`;
    await assert.rejects(assertPrivateStorageMount({
      nodeEnv: 'production',
      directory: '/data/private',
      platform: 'linux',
      readMountInfo: async () => mountInfo,
      canonicalizePath: async (value) => value,
    }), /separate non-ephemeral mount/u);
  }

  await assertPrivateStorageMount({
    nodeEnv: 'production',
    directory: '/data/private',
    platform: 'linux',
    readMountInfo: async () => mountedData,
    canonicalizePath: async (value) => value,
  });
});

test('a root mount is rejected regardless of its filesystem type', async () => {
  const persistentLookingRoot = '1 0 8:1 / / rw,relatime - ext4 /dev/root rw\n';
  await assert.rejects(assertPrivateStorageMount({
    nodeEnv: 'production',
    directory: '/data/private',
    platform: 'linux',
    readMountInfo: async () => persistentLookingRoot,
    canonicalizePath: async (value) => value,
  }), /separate non-ephemeral mount/u);
});

test('the deepest mount is authoritative when a known ephemeral mount is nested inside a volume', async () => {
  const nestedEphemeral = `${mountedData}3 2 0:3 / /data/private rw - overlay overlay rw\n`;
  await assert.rejects(assertPrivateStorageMount({
    nodeEnv: 'production',
    directory: '/data/private/pdfs',
    platform: 'linux',
    readMountInfo: async () => nestedEphemeral,
    canonicalizePath: async (value) => value,
  }), /separate non-ephemeral mount/u);
});

test('production storage check fails closed when mount metadata is unavailable or unsupported', async () => {
  await assert.rejects(assertPrivateStorageMount({
    nodeEnv: 'production',
    directory: '/data/private',
    platform: 'linux',
    readMountInfo: async () => { throw new Error('unavailable'); },
    canonicalizePath: async (value) => value,
  }), /mount could not be verified/u);
  await assert.rejects(assertPrivateStorageMount({
    nodeEnv: 'production',
    directory: '/data/private',
    platform: 'win32',
  }), /beneath a mounted volume/u);
});

test('production mount validation evaluates the canonical path when configured storage is a symlink', async () => {
  await assert.rejects(assertPrivateStorageMount({
    nodeEnv: 'production',
    directory: '/data/private',
    platform: 'linux',
    readMountInfo: async () => mountedData,
    canonicalizePath: async () => '/tmp/private',
  }), /separate non-ephemeral mount/u);
});

test('non-production startup does not require a mounted storage volume', async () => {
  await assert.doesNotReject(assertPrivateStorageMount({
    nodeEnv: 'test',
    directory: '/temporary/test-storage',
    readMountInfo: async () => { throw new Error('must not be read'); },
  }));
});
