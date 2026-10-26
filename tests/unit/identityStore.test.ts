// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { publicBundle, samePublicKey } from '../../src/lib/crypto';
import {
  clearIdentity,
  clearIdentityMemoryCache,
  commitSignupIdentity,
  getOrCreateIdentity,
  stageSignupIdentity,
} from '../../src/lib/identityStore';

describe('identityStore per-user isolation', () => {
  beforeEach(() => {
    clearIdentityMemoryCache();
  });

  it('isolates device identities across distinct user accounts', async () => {
    const alice = await getOrCreateIdentity('user-alice', null, 'alice@example.com');
    const bob = await getOrCreateIdentity('user-bob', null, 'bob@example.com');

    expect(samePublicKey(publicBundle(alice), publicBundle(bob))).toBe(false);

    const aliceReloaded = await getOrCreateIdentity(
      'user-alice',
      publicBundle(alice),
      'alice@example.com',
    );
    expect(samePublicKey(publicBundle(alice), publicBundle(aliceReloaded))).toBe(true);
  });

  it('commits a staged signup identity exclusively to that user', async () => {
    const staged = await stageSignupIdentity('newuser@example.com');
    await commitSignupIdentity('user-new', 'newuser@example.com', staged);

    const loaded = await getOrCreateIdentity(
      'user-new',
      publicBundle(staged),
      'newuser@example.com',
    );
    expect(samePublicKey(publicBundle(staged), publicBundle(loaded))).toBe(true);

    await clearIdentity('user-new', 'newuser@example.com');
    const afterDelete = await getOrCreateIdentity('user-new', null, 'newuser@example.com');
    expect(samePublicKey(publicBundle(staged), publicBundle(afterDelete))).toBe(false);
  });
});
