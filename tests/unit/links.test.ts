import { describe, expect, it } from 'vitest';
import { assessLink, containsLink, splitTextWithLinks } from '../../src/lib/links';

describe('link safety', () => {
  it('assesses HTTPS links', () => {
    const link = assessLink('https://example.com/docs?q=1');

    expect(link).toMatchObject({
      host: 'example.com',
      protocol: 'https:',
      canOpen: true,
      warnings: [],
    });
  });

  it('adds a scheme to www links', () => {
    expect(assessLink('www.example.com')).toMatchObject({
      href: 'https://www.example.com/',
      canOpen: true,
    });
  });

  it('refuses plaintext HTTP and hidden credentials', () => {
    expect(assessLink('http://example.com')?.canOpen).toBe(false);
    expect(assessLink('https://user:pass@example.com')?.canOpen).toBe(false);
    expect(assessLink('https://user:pass@example.com')?.warnings[0]).toMatch(/hidden credentials/i);
  });

  it('warns about raw IPs, punycode, deep subdomains, and long hosts', () => {
    expect(assessLink('https://192.168.1.10')?.warnings).toContain(
      'This link points to a raw IP address.',
    );
    expect(assessLink('https://xn--exmple-cua.com')?.warnings.join(' ')).toMatch(
      /internationalized domain/i,
    );
    expect(assessLink('https://a.b.c.d.example.com')?.warnings.join(' ')).toMatch(
      /deep subdomain/i,
    );
    expect(assessLink(`https://${'a'.repeat(50)}.example.com`)?.warnings.join(' ')).toMatch(
      /long hostname/i,
    );
  });

  it('ignores non-web schemes', () => {
    expect(assessLink('javascript:alert(1)')).toBeNull();
    expect(assessLink('data:text/html,hello')).toBeNull();
    expect(assessLink('mailto:person@example.com')).toBeNull();
  });

  it('splits text and strips trailing punctuation', () => {
    const parts = splitTextWithLinks('Look at https://example.com/page, then reply.');

    expect(parts).toHaveLength(4);
    expect(parts[1]).toMatchObject({ type: 'link', href: 'https://example.com/page' });
    expect(parts[2]).toEqual({ type: 'text', value: ',' });
    expect(parts[3]).toEqual({ type: 'text', value: ' then reply.' });
  });

  it('keeps plain text intact', () => {
    expect(splitTextWithLinks('no links here')).toEqual([{ type: 'text', value: 'no links here' }]);
    expect(containsLink('https://example.com')).toBe(true);
    expect(containsLink('just words')).toBe(false);
  });
});
