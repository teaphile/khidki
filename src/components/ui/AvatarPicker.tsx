import type { AvatarId } from '../../types';
import { AVATAR_PRESETS } from '../../lib/avatars';
import { Avatar } from './Avatar';

export function AvatarPicker({
  value,
  onChange,
  name,
  seed,
}: {
  value: AvatarId;
  onChange: (next: AvatarId) => void;
  name: string;
  seed: string;
}) {
  return (
    <div className="avatar-picker" role="radiogroup" aria-label="Choose profile sticker">
      {AVATAR_PRESETS.map((preset) => {
        const selected = value === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={preset.label}
            title={preset.label}
            className={`avatar-picker__option${selected ? ' is-selected' : ''}`}
            onClick={() => onChange(preset.id)}
          >
            <Avatar name={name || 'You'} seed={seed || 'preview'} avatarId={preset.id} size="sm" />
            <span className="avatar-picker__label">{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
}
