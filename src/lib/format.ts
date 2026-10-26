import type { Conversation } from '../types';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function avatarHue(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  return hash;
}

export function dmPeer(conversation: Conversation, myId: string) {
  return conversation.members.find((member) => member.userId !== myId) ?? null;
}

export function conversationTitle(conversation: Conversation, myId: string): string {
  if (conversation.kind === 'group') return conversation.title;
  return dmPeer(conversation, myId)?.displayName ?? 'Direct message';
}

export function conversationHandle(conversation: Conversation, myId: string): string {
  if (conversation.kind === 'group') {
    const count = conversation.members.length;
    return `${count} ${count === 1 ? 'member' : 'members'}`;
  }
  const peer = dmPeer(conversation, myId);
  return peer ? `@${peer.username}` : 'Private chat';
}

export function conversationSeed(conversation: Conversation, myId: string): string {
  if (conversation.kind === 'group') return conversation.id;
  return dmPeer(conversation, myId)?.userId ?? conversation.id;
}

export function conversationDpUrl(conversation: Conversation, myId: string): string | null {
  if (conversation.kind === 'group') return null;
  return dmPeer(conversation, myId)?.avatarUrl ?? null;
}

export function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function formatListTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return formatClock(timestamp);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

export function formatRemaining(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatCallDuration(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function pluralize(count: number, single: string, plural = `${single}s`): string {
  return `${count} ${count === 1 ? single : plural}`;
}
