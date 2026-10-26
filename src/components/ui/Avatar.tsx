import type { CSSProperties } from 'react';
import type { AvatarId } from '../../types';
import { getAvatarPreset } from '../../lib/avatars';
import { avatarHue, initials } from '../../lib/format';

export function Avatar({
  name,
  seed,
  avatarId = 'initials',
  size = 'md',
  group = false,
}: {
  name: string;
  seed: string;
  avatarId?: AvatarId;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'small' | 'large';
  group?: boolean;
}) {
  const normalizedSize = size === 'small' ? 'sm' : size === 'large' ? 'lg' : size;
  const hue = avatarHue(seed || name);
  const preset = !group && avatarId && avatarId !== 'initials' ? getAvatarPreset(avatarId) : null;

  const style = preset
    ? ({
        '--avatar-hue': hue,
        background: `linear-gradient(145deg, ${preset.bgStart}, ${preset.bgEnd})`,
        color: preset.ink,
      } as CSSProperties)
    : ({ '--avatar-hue': hue } as CSSProperties);

  return (
    <span
      className={`avatar avatar--${normalizedSize}${group ? ' avatar--group' : ''}${preset ? ' avatar--sticker' : ''}`}
      style={style}
      aria-hidden="true"
    >
      {preset ? (
        <span className="avatar__symbol">{preset.symbol}</span>
      ) : (
        <span>{initials(name)}</span>
      )}
    </span>
  );
}
