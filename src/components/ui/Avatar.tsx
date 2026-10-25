import type { CSSProperties } from 'react';
import { avatarHue, initials } from '../../lib/format';

type AvatarProps = {
  name: string;
  seed: string;
  size?: 'small' | 'medium' | 'large' | 'hero';
  group?: boolean;
};

export function Avatar({ name, seed, size = 'medium', group = false }: AvatarProps) {
  const hue = avatarHue(seed);
  const style = {
    '--avatar-hue': hue,
    '--avatar-hue-soft': (hue + 18) % 360,
  } as CSSProperties;

  return (
    <span
      className={`avatar avatar--${size}${group ? ' avatar--group' : ''}`}
      style={style}
      aria-hidden="true"
    >
      <span>{initials(name)}</span>
    </span>
  );
}
