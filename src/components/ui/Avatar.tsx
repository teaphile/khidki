import type { CSSProperties } from 'react';
import { Users } from 'lucide-react';
import { isValidDpDataUrl } from '../../lib/dp';
import { avatarHue, initials } from '../../lib/format';

export type AvatarSize = 'xs' | 'sm' | 'small' | 'md' | 'lg' | 'large' | 'xl';

type Props = {
  name: string;
  seed?: string;
  dpUrl?: string | null;
  group?: boolean;
  size?: AvatarSize;
  online?: boolean;
};

function normalizeSize(size: AvatarSize): 'xs' | 'sm' | 'md' | 'lg' | 'xl' {
  if (size === 'small') return 'sm';
  if (size === 'large') return 'lg';
  return size;
}

export function Avatar({ name, seed, dpUrl, group = false, size = 'md', online }: Props) {
  const normalized = normalizeSize(size);
  const hue = avatarHue(seed ?? name);
  const style = { '--avatar-hue': String(hue) } as CSSProperties;
  const hasDp = !group && isValidDpDataUrl(dpUrl);
  const iconSize =
    normalized === 'xl' ? 28 : normalized === 'lg' ? 22 : normalized === 'sm' ? 15 : 18;

  return (
    <span
      className={`avatar avatar--${normalized}${hasDp ? ' avatar--photo' : ''}${group ? ' avatar--group' : ''}`}
      style={style}
      aria-hidden="true"
    >
      {hasDp ? (
        <img className="avatar__image" src={dpUrl} alt="" decoding="async" draggable={false} />
      ) : group ? (
        <Users className="avatar__group-icon" size={iconSize} strokeWidth={2.1} />
      ) : (
        <span className="avatar__initials">{initials(name)}</span>
      )}
      {online !== undefined ? (
        <span className={`avatar__dot ${online ? 'is-online' : 'is-offline'}`} />
      ) : null}
    </span>
  );
}
