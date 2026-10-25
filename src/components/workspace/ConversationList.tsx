import { useMemo, useState } from 'react';
import { Loader2, MessageSquarePlus, Plus, Search, Users, WifiOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { conversationSeed, conversationTitle, formatListTime } from '../../lib/format';
import type { Conversation } from '../../types';
import { Avatar } from '../ui/Avatar';
import { LogoMark } from '../ui/LogoMark';

function previewFor(
  last:
    | {
        kind: string;
        text?: string;
        attachment?: { name: string };
        senderId: string;
        senderName: string;
      }
    | undefined,
  isGroup: boolean,
  myId: string,
) {
  if (!last) return 'No messages are kept';
  const prefix = isGroup && last.senderId !== myId ? `${last.senderName.split(' ')[0]}: ` : '';
  if (last.kind === 'file') {
    return `${prefix}${last.text ? `${last.text} · ` : ''}${last.attachment?.name ?? 'Attachment'}`;
  }
  return `${prefix}${last.text ?? ''}`;
}

export function ConversationList({
  onSelect,
  onNewGroup,
  onFindPeople,
}: {
  onSelect: (conversation: Conversation) => void;
  onNewGroup: () => void;
  onFindPeople: () => void;
}) {
  const { profile } = useAuth();
  const {
    conversations,
    conversationsLoading,
    conversationsError,
    messages,
    unread,
    activeId,
    connection,
    refreshConversations,
  } = useChat();
  const [query, setQuery] = useState('');
  const myId = profile?.id ?? '';

  const sorted = useMemo(() => {
    const filtered = conversations.filter((conversation) => {
      if (!query.trim()) return true;
      const needle = query.trim().toLowerCase();
      return (
        conversationTitle(conversation, myId).toLowerCase().includes(needle) ||
        conversation.members.some((member) => member.username.includes(needle))
      );
    });
    return [...filtered].sort((left, right) => {
      const leftLast = messages[left.id]?.[messages[left.id].length - 1];
      const rightLast = messages[right.id]?.[messages[right.id].length - 1];
      return (
        (rightLast?.createdAt ?? Date.parse(right.createdAt)) -
        (leftLast?.createdAt ?? Date.parse(left.createdAt))
      );
    });
  }, [conversations, messages, myId, query]);

  return (
    <div className="list-view">
      <div className="mobile-brand">
        <span className="brand">
          <LogoMark size={30} />
          <span>Sotto</span>
        </span>
        <span className="mobile-brand__tag">Nothing kept</span>
      </div>

      <header className="list-header">
        <div>
          <span className="eyebrow">Your space</span>
          <h1>Chats</h1>
        </div>
        <button
          type="button"
          className="icon-button icon-button--raised"
          onClick={onNewGroup}
          aria-label="Create a group"
          title="Create a group"
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      </header>

      <div className="list-search">
        <Search size={17} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
          maxLength={40}
        />
      </div>

      {connection === 'offline' ? (
        <div className="connection-banner connection-banner--error">
          <WifiOff size={15} aria-hidden="true" />
          You are offline. Messages cannot be sent.
        </div>
      ) : null}

      <div className="conversation-scroll" role="list" aria-label="Conversations">
        {conversationsLoading && !conversations.length ? (
          <div className="list-loading" aria-label="Loading conversations">
            <Loader2 className="spin" size={22} aria-hidden="true" />
            <span>Loading conversations…</span>
          </div>
        ) : null}

        {conversationsError && !conversations.length ? (
          <div className="empty-panel">
            <span className="empty-panel__icon">
              <WifiOff size={22} aria-hidden="true" />
            </span>
            <strong>Conversations are unavailable</strong>
            <p>{conversationsError}</p>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void refreshConversations()}
            >
              Try again
            </button>
          </div>
        ) : null}

        {!conversationsLoading && !conversationsError && !conversations.length ? (
          <div className="empty-panel empty-panel--conversations">
            <span className="empty-panel__icon">
              <MessageSquarePlus size={23} aria-hidden="true" />
            </span>
            <strong>Start something private</strong>
            <p>Find a person by username, or create a small group. Nothing is archived.</p>
            <div className="empty-panel__actions">
              <button type="button" className="button button--primary" onClick={onFindPeople}>
                Find people
              </button>
              <button type="button" className="button button--ghost" onClick={onNewGroup}>
                <Users size={16} aria-hidden="true" /> New group
              </button>
            </div>
          </div>
        ) : null}

        {conversations.length && !sorted.length ? (
          <div className="empty-panel">
            <span className="empty-panel__icon">
              <Search size={21} aria-hidden="true" />
            </span>
            <strong>No matching conversations</strong>
            <p>Try a different name or username.</p>
          </div>
        ) : null}

        {sorted.map((conversation) => {
          const title = conversationTitle(conversation, myId);
          const last = messages[conversation.id]?.[messages[conversation.id].length - 1];
          const count = unread[conversation.id] ?? 0;
          return (
            <button
              type="button"
              key={conversation.id}
              className={`conversation${conversation.id === activeId ? ' is-active' : ''}`}
              onClick={() => onSelect(conversation)}
              aria-current={conversation.id === activeId ? 'true' : undefined}
              role="listitem"
            >
              <Avatar
                name={title}
                seed={conversationSeed(conversation, myId)}
                group={conversation.kind === 'group'}
              />
              <span className="conversation__content">
                <span className="conversation__top">
                  <strong>{title}</strong>
                  <span className="conversation__time">
                    {last ? formatListTime(last.createdAt) : ''}
                  </span>
                </span>
                <span className="conversation__bottom">
                  <span className="conversation__preview">
                    {previewFor(last, conversation.kind === 'group', myId)}
                  </span>
                  {count > 0 ? (
                    <span className="unread-badge" aria-label={`${count} unread messages`}>
                      {count > 9 ? '9+' : count}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="list-footer-note">
        <span className="status-dot" data-state={connection} aria-hidden="true" />
        <span>
          {connection === 'connected'
            ? 'Realtime connected'
            : connection === 'offline'
              ? 'Offline'
              : 'Connecting…'}
        </span>
        <span className="list-footer-note__sep">·</span>
        <span>Ephemeral by design</span>
      </div>
    </div>
  );
}
