import { useMemo, useState } from 'react';
import {
  ChevronRight,
  Hourglass,
  Inbox,
  Plus,
  RefreshCw,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import {
  conversationDpUrl,
  conversationHandle,
  conversationSeed,
  conversationTitle,
  formatListTime,
} from '../../lib/format';
import { Avatar } from '../ui/Avatar';

export function ConversationList({
  onOpenPeople,
  onOpenRequests,
  onOpenNewGroup,
}: {
  onOpenPeople: () => void;
  onOpenRequests: () => void;
  onOpenNewGroup: () => void;
}) {
  const { profile } = useAuth();
  const {
    activeChats,
    incomingRequestCount,
    conversationsLoading,
    conversationsError,
    activeId,
    messages,
    unread,
    connection,
    setActiveId,
    refreshConversations,
  } = useChat();
  const [filter, setFilter] = useState('');
  const myId = profile?.id ?? '';

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return activeChats;
    return activeChats.filter((conversation) => {
      const title = conversationTitle(conversation, myId).toLowerCase();
      const handle = conversationHandle(conversation, myId).toLowerCase();
      return title.includes(query) || handle.includes(query);
    });
  }, [activeChats, filter, myId]);

  return (
    <section className="panel" aria-label="Conversations">
      <header className="panel__header">
        <div>
          <span className="eyebrow">Inbox</span>
          <h1>Chats</h1>
        </div>
        <div className="panel__actions">
          <button
            type="button"
            className="icon-button icon-button--raised"
            onClick={onOpenPeople}
            aria-label="Start a direct message"
            title="Find someone by username"
          >
            <UserPlus size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button icon-button--raised"
            onClick={onOpenNewGroup}
            aria-label="Create a group"
            title="New group"
          >
            <Plus size={19} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="panel__status">
        <span className={`status-dot status-dot--${connection}`} />
        <span>
          {connection === 'connected'
            ? 'Live encrypted sync'
            : connection === 'connecting'
              ? 'Connecting...'
              : 'Offline'}
        </span>
        <span className="panel__ttl" title="Messages auto-delete one minute after reading">
          <Hourglass size={13} aria-hidden="true" /> Auto-delete after 1 minute
        </span>
      </div>

      {incomingRequestCount > 0 ? (
        <button type="button" className="request-banner-pill" onClick={onOpenRequests}>
          <span className="request-banner-pill__icon">
            <Inbox size={16} aria-hidden="true" />
          </span>
          <span className="request-banner-pill__text">
            <strong>
              {incomingRequestCount}{' '}
              {incomingRequestCount === 1 ? 'message request' : 'message requests'}
            </strong>
            <small>Tap to review who messaged you</small>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      ) : null}

      {activeChats.length > 0 ? (
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search your chats"
            aria-label="Search chats"
          />
        </label>
      ) : null}

      <div className="panel__body">
        {conversationsLoading && !activeChats.length ? (
          <div className="skeleton-list" aria-label="Loading conversations">
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <div className="skeleton-row" />
          </div>
        ) : conversationsError ? (
          <div className="empty-card">
            <p>{conversationsError}</p>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void refreshConversations()}
            >
              <RefreshCw size={15} aria-hidden="true" /> Try again
            </button>
          </div>
        ) : !filtered.length ? (
          <div className="empty-card">
            <h2>{filter ? 'No matching chats' : 'No active chats yet'}</h2>
            <p>
              {filter
                ? 'Try another name or @username.'
                : 'Search by username to send a message request, or create a group.'}
            </p>
            {!filter ? (
              <div className="empty-card__actions">
                <button type="button" className="button button--primary" onClick={onOpenPeople}>
                  <UserPlus size={16} aria-hidden="true" /> Find people
                </button>
                <button type="button" className="button button--secondary" onClick={onOpenNewGroup}>
                  <Users size={16} aria-hidden="true" /> New group
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <ul className="chat-list">
            {filtered.map((conversation) => {
              const title = conversationTitle(conversation, myId);
              const handle = conversationHandle(conversation, myId);
              const list = messages[conversation.id] ?? [];
              const last = list[list.length - 1];
              const unreadCount = unread[conversation.id] ?? 0;
              const isPendingOutgoing =
                conversation.kind === 'dm' &&
                conversation.requestStatus === 'pending' &&
                conversation.requestedBy === myId;
              const preview = last
                ? last.kind === 'file'
                  ? `Attachment: ${last.attachment?.name ?? 'File'}`
                  : (last.text ?? '')
                : isPendingOutgoing
                  ? 'Request pending · no expiry'
                  : handle;
              const time = last
                ? formatListTime(last.createdAt)
                : formatListTime(Date.parse(conversation.lastMessageAt || conversation.createdAt));

              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    className={`chat-row${activeId === conversation.id ? ' is-active' : ''}${unreadCount > 0 ? ' is-unread' : ''}`}
                    onClick={() => setActiveId(conversation.id)}
                  >
                    <Avatar
                      name={title}
                      seed={conversationSeed(conversation, myId)}
                      dpUrl={conversationDpUrl(conversation, myId)}
                      group={conversation.kind === 'group'}
                    />
                    <span className="chat-row__body">
                      <span className="chat-row__top">
                        <strong className="truncate">{title}</strong>
                        <time>{time}</time>
                      </span>
                      <span className="chat-row__bottom">
                        <span className="truncate">{preview}</span>
                        {unreadCount > 0 ? (
                          <span className="unread-pill">
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                        ) : isPendingOutgoing ? (
                          <span
                            className="pending-pill"
                            title="Pending with no expiry. Open this chat to cancel."
                          >
                            Pending
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
