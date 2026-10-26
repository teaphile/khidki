import { AVATAR_IDS, type AvatarId } from '../types';

export type AvatarPreset = {
  id: AvatarId;
  label: string;
  symbol: string;
  bgStart: string;
  bgEnd: string;
  ink: string;
};

export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  {
    id: 'initials',
    label: 'Classic',
    symbol: 'Aa',
    bgStart: '#e4573d',
    bgEnd: '#1f6f68',
    ink: '#fffaf2',
  },
  {
    id: 'fox',
    label: 'Kitsune',
    symbol: '🦊',
    bgStart: '#ea580c',
    bgEnd: '#9a3412',
    ink: '#fff7ed',
  },
  {
    id: 'owl',
    label: 'Night Owl',
    symbol: '🦉',
    bgStart: '#4338ca',
    bgEnd: '#1e1b4b',
    ink: '#eef2ff',
  },
  {
    id: 'cat',
    label: 'Shadow Cat',
    symbol: '🐈‍⬛',
    bgStart: '#334155',
    bgEnd: '#0f172a',
    ink: '#f8fafc',
  },
  {
    id: 'wolf',
    label: 'Lone Wolf',
    symbol: '🐺',
    bgStart: '#0f766e',
    bgEnd: '#134e4a',
    ink: '#f0fdfa',
  },
  {
    id: 'panda',
    label: 'Panda',
    symbol: '🐼',
    bgStart: '#15803d',
    bgEnd: '#14532d',
    ink: '#f0fdf4',
  },
  {
    id: 'crown',
    label: 'Crown',
    symbol: '👑',
    bgStart: '#b45309',
    bgEnd: '#78350f',
    ink: '#fffbeb',
  },
  {
    id: 'bolt',
    label: 'Spark',
    symbol: '⚡',
    bgStart: '#ca8a04',
    bgEnd: '#854d0e',
    ink: '#fefce8',
  },
  {
    id: 'flame',
    label: 'Ember',
    symbol: '🔥',
    bgStart: '#dc2626',
    bgEnd: '#7f1d1d',
    ink: '#fef2f2',
  },
  {
    id: 'moon',
    label: 'Crescent',
    symbol: '🌙',
    bgStart: '#1d4ed8',
    bgEnd: '#172554',
    ink: '#eff6ff',
  },
  {
    id: 'star',
    label: 'Nova',
    symbol: '✦',
    bgStart: '#7c3aed',
    bgEnd: '#3b0764',
    ink: '#faf5ff',
  },
  {
    id: 'lotus',
    label: 'Lotus',
    symbol: '🪷',
    bgStart: '#be185d',
    bgEnd: '#831843',
    ink: '#fdf2f8',
  },
  {
    id: 'gem',
    label: 'Prism',
    symbol: '💎',
    bgStart: '#0284c7',
    bgEnd: '#0c4a6e',
    ink: '#f0f9ff',
  },
  {
    id: 'wave',
    label: 'Tide',
    symbol: '🌊',
    bgStart: '#0369a1',
    bgEnd: '#164e63',
    ink: '#ecfeff',
  },
  {
    id: 'shield',
    label: 'Aegis',
    symbol: '🛡️',
    bgStart: '#1f6f68',
    bgEnd: '#0f2f2c',
    ink: '#ecfdf5',
  },
  {
    id: 'music',
    label: 'Pulse',
    symbol: '🎵',
    bgStart: '#9333ea',
    bgEnd: '#4c1d95',
    ink: '#f5f3ff',
  },
  {
    id: 'rocket',
    label: 'Orbit',
    symbol: '🚀',
    bgStart: '#c2410c',
    bgEnd: '#431407',
    ink: '#fff7ed',
  },
] as const;

const AVATAR_MAP = new Map<string, AvatarPreset>(
  AVATAR_PRESETS.map((preset) => [preset.id, preset]),
);

export function parseAvatarId(value: unknown): AvatarId {
  if (typeof value === 'string' && (AVATAR_IDS as readonly string[]).includes(value)) {
    return value as AvatarId;
  }
  return 'initials';
}

export function getAvatarPreset(avatarId?: AvatarId | string | null): AvatarPreset {
  return AVATAR_MAP.get(avatarId ?? 'initials') ?? AVATAR_PRESETS[0];
}
