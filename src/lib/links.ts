export type TextPart =
  { type: 'text'; value: string } | { type: 'link'; value: string; href: string; label: string };

export type LinkAssessment = {
  href: string;
  host: string;
  protocol: 'https:' | 'http:';
  canOpen: boolean;
  warnings: string[];
};

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING = /[.,!?;:)\]}'"]+$/;

function isIpHost(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(':') && /^[0-9a-f:]+$/i.test(host);
}

export function assessLink(raw: string): LinkAssessment | null {
  const trimmed = raw.trim().replace(TRAILING, '');
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.hostname || url.username || url.password) {
    return {
      href: url.href,
      host: url.hostname || 'unknown host',
      protocol: url.protocol === 'http:' ? 'http:' : 'https:',
      canOpen: false,
      warnings: ['This link contains hidden credentials and cannot be opened safely.'],
    };
  }

  const warnings: string[] = [];
  if (url.protocol === 'http:') warnings.push('This link is not encrypted (HTTP).');
  if (isIpHost(url.hostname)) warnings.push('This link points to a raw IP address.');
  if (url.hostname.startsWith('xn--') || url.hostname.includes('.xn--')) {
    warnings.push('This link uses an internationalized domain that can imitate another site.');
  }
  if (url.hostname.split('.').length > 4)
    warnings.push('This address has an unusually deep subdomain.');
  if (url.hostname.length > 48) warnings.push('This address has an unusually long hostname.');

  return {
    href: url.href,
    host: url.hostname,
    protocol: url.protocol === 'http:' ? 'http:' : 'https:',
    canOpen: url.protocol === 'https:',
    warnings,
  };
}

export function splitTextWithLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    const raw = match[0];
    const trimmed = raw.replace(TRAILING, '');
    const suffix = raw.slice(trimmed.length);
    const assessment = assessLink(trimmed);
    if (!assessment) continue;

    if (index > cursor) parts.push({ type: 'text', value: text.slice(cursor, index) });
    parts.push({
      type: 'link',
      value: trimmed,
      href: assessment.href,
      label: assessment.host + (new URL(assessment.href).pathname !== '/' ? '…' : ''),
    });
    if (suffix) parts.push({ type: 'text', value: suffix });
    cursor = index + raw.length;
  }

  if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) });
  return parts.length ? parts : [{ type: 'text', value: text }];
}

export function containsLink(text: string): boolean {
  URL_PATTERN.lastIndex = 0;
  return URL_PATTERN.test(text);
}

export function hostOf(href: string): string {
  try {
    return new URL(href).hostname;
  } catch {
    return 'unknown host';
  }
}
