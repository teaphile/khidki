import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/0004_security_hardening.sql', 'utf8');

describe('profile-email access migration', () => {
  it('revokes broad profile access and explicitly denies canonical-email reads', () => {
    expect(migration).toMatch(
      /revoke all privileges on table public\.profiles from public, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /revoke select \(canonical_email\) on table public\.profiles from public, anon, authenticated/i,
    );
  });

  it('grants only the profile columns consumed by authenticated clients', () => {
    const selectGrant = migration.match(
      /grant select\s*\(([^)]+)\)\s*on table public\.profiles to authenticated/i,
    );
    expect(selectGrant).not.toBeNull();
    expect(selectGrant?.[1]).toBe('id, username, display_name, avatar_url, public_key, created_at');
    expect(migration).not.toMatch(/grant select on table public\.profiles to authenticated/i);
  });
});
