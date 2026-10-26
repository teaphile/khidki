import { useState } from 'react';
import { Check, CircleDot, Inbox, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { useToast } from '../../context/ToastContext';
import {
  conversationDpUrl,
  conversationHandle,
  conversationSeed,
  conversationTitle,
  formatRequestDate,
  pluralize,
} from '../../lib/format';
import { Avatar } from '../ui/Avatar';

export function RequestsPanel({ onAccepted }: { onAccepted: () => void }) {
  const { profile } = useAuth();
  const {
    incomingRequests,
    messages,
    unread,
    activeId,
    setActiveId,
    acceptRequest,
    declineRequest,
  } = useChat();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const myId = profile?.id ?? '';

  const handleAccept = async (conversationId: string) => {
    setBusyId(conversationId);
    try {
      await acceptRequest(conversationId);
      onAccepted();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to accept request.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (conversationId: string) => {
    setBusyId(conversationId);
    try {
      await declineRequest(conversationId);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to remove request.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="panel" aria-label="Message requests">
      <header className="panel__header">
        <div>
          <span className="eyebrow">Protected inbox</span>
          <h1>Requests</h1>
        </div>
      </header>

      <div className="panel__status">
        <ShieldCheck size={14} aria-hidden="true" />
        <span>
          Requests have no expiry. Accept, remove, or leave them pending; message auto-delete rules
          still apply.
        </span>
      </div>

      <div className="panel__body">
        {!incomingRequests.length ? (
          <div className="empty-card">
            <Inbox size={26} aria-hidden="true" />
            <h2>No pending requests</h2>
            <p>
              When someone searches your @username and messages you for the first time, their
              request shows up here.
            </p>
          </div>
        ) : (
          <ul className="request-list">
            {incomingRequests.map((conversation) => {
              const title = conversationTitle(conversation, myId);
              const handle = conversationHandle(conversation, myId);
              const list = messages[conversation.id] ?? [];
              const unreadCount = unread[conversation.id] ?? list.length;
              const last = list[list.length - 1];
              const busy = busyId === conversation.id;
              const activityAt = last
                ? last.createdAt
                : Date.parse(conversation.lastMessageAt || conversation.createdAt);
              const activityDate = new Date(activityAt);
              const activityDateTime = Number.isFinite(activityDate.getTime())
                ? activityDate.toISOString()
                : undefined;
              const activityLabel = formatRequestDate(activityAt);

              return (
                <li
                  key={conversation.id}
                  className={`request-card${activeId === conversation.id ? ' is-active' : ''}`}
                >
                  <button
                    type="button"
                    className="request-card__main"
                    onClick={() => setActiveId(conversation.id)}
                    aria-label={`Open request from ${title}`}
                  >
                    <Avatar
                      name={title}
                      seed={conversationSeed(conversation, myId)}
                      dpUrl={conversationDpUrl(conversation, myId)}
                    />
                    <span className="request-card__info">
                      <span className="request-card__top">
                        <strong className="truncate">{title}</strong>
                        <time
                          dateTime={activityDateTime}
                          title={`Latest message: ${activityLabel}`}
                          aria-label={`Latest message on ${activityLabel}`}
                        >
                          {activityLabel}
                        </time>
                      </span>
                      <span className="request-card__meta">
                        <span className="request-card__handle">{handle}</span>
                        <span className="request-card__status">
                          <CircleDot size={12} aria-hidden="true" /> Pending · no expiry
                        </span>
                      </span>
                      <span className="request-card__preview truncate">
                        {unreadCount > 0
                          ? `${pluralize(unreadCount, 'unread message')} · tap to view`
                          : last?.text || 'Sent you a message request'}
                      </span>
                    </span>
                  </button>

                  <div className="request-card__actions">
                    <button
                      type="button"
                      className="button button--primary button--compact"
                      disabled={busy}
                      onClick={() => void handleAccept(conversation.id)}
                      title={`Accept request from ${title}`}
                    >
                      {busy ? (
                        <Loader2 className="spin" size={14} aria-hidden="true" />
                      ) : (
                        <Check size={14} aria-hidden="true" />
                      )}
                      Accept
                    </button>
                    <button
                      type="button"
                      className="button button--secondary button--compact"
                      disabled={busy}
                      onClick={() => void handleDecline(conversation.id)}
                      title={`Remove request from ${title} and delete its queued messages`}
                    >
                      <Trash2 size={14} aria-hidden="true" /> Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
