import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Hourglass,
  PanelRightOpen,
  Loader2,
  Lock,
  MessageSquare,
  Phone,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';
import { useChat } from '../../context/ChatContext';
import { useToast } from '../../context/ToastContext';
import {
  conversationDpUrl,
  conversationHandle,
  conversationSeed,
  conversationTitle,
  dmPeer,
} from '../../lib/format';
import type { LinkAssessment } from '../../lib/links';
import { Avatar } from '../ui/Avatar';
import { LogoMark } from '../ui/LogoMark';
import { Composer } from './Composer';
import { LinkDialog } from './LinkDialog';
import { MessageBubble } from './MessageBubble';

export function ConversationView({
  enterToSend,
  onBack,
  onOpenInfo,
  onOpenPeople,
  onOpenNewGroup,
}: {
  enterToSend: boolean;
  onBack: () => void;
  onOpenInfo: () => void;
  onOpenPeople: () => void;
  onOpenNewGroup: () => void;
}) {
  const { profile } = useAuth();
  const { activeConversation, messages, acceptRequest, declineRequest } = useChat();
  const { startCall } = useCall();
  const { toast } = useToast();
  const [linkToConfirm, setLinkToConfirm] = useState<LinkAssessment | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const myId = profile?.id ?? '';

  const list = useMemo(
    () => (activeConversation ? (messages[activeConversation.id] ?? []) : []),
    [activeConversation, messages],
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [activeConversation?.id, list.length]);

  if (!activeConversation) {
    return (
      <section className="stage-empty" aria-label="No conversation selected">
        <LogoMark size={46} />
        <span className="eyebrow">Chats stay closed on login</span>
        <h2>Select a chat or find someone by username</h2>
        <p>
          Unread messages stay encrypted while you are away. After everyone else in a chat has read
          a message, it disappears after one minute.
        </p>
        <div className="stage-empty__actions">
          <button type="button" className="button button--primary" onClick={onOpenPeople}>
            <UserPlus size={17} aria-hidden="true" /> Find people
          </button>
          <button type="button" className="button button--secondary" onClick={onOpenNewGroup}>
            <Users size={17} aria-hidden="true" /> Create a group
          </button>
        </div>
      </section>
    );
  }

  const title = conversationTitle(activeConversation, myId);
  const handle = conversationHandle(activeConversation, myId);
  const peer = dmPeer(activeConversation, myId);
  const isPending =
    activeConversation.kind === 'dm' && activeConversation.requestStatus === 'pending';
  const isIncomingPending =
    isPending && activeConversation.requestedBy !== null && activeConversation.requestedBy !== myId;
  const isOutgoingPending = isPending && activeConversation.requestedBy === myId;
  const canCall = activeConversation.kind === 'dm' && Boolean(peer) && !isPending;

  const handleAccept = async () => {
    setRequestBusy(true);
    try {
      await acceptRequest(activeConversation.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to accept request.', 'error');
    } finally {
      setRequestBusy(false);
    }
  };

  const handleDecline = async () => {
    setRequestBusy(true);
    try {
      await declineRequest(activeConversation.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to remove request.', 'error');
    } finally {
      setRequestBusy(false);
    }
  };

  return (
    <section className="conversation" aria-label={`Conversation with ${title}`}>
      <header className="conversation__header">
        <button
          type="button"
          className="icon-button mobile-only"
          onClick={onBack}
          aria-label="Back to conversations"
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="conversation__identity"
          onClick={onOpenInfo}
          aria-label={`Details for ${title}`}
        >
          <Avatar
            name={title}
            seed={conversationSeed(activeConversation, myId)}
            dpUrl={conversationDpUrl(activeConversation, myId)}
            group={activeConversation.kind === 'group'}
          />
          <span className="conversation__titles">
            <strong className="truncate">{title}</strong>
            <span className="truncate">{handle}</span>
          </span>
        </button>

        <div className="conversation__tools">
          <span className="encryption-badge" title="End-to-end encrypted in your browser">
            <Lock size={13} aria-hidden="true" /> Encrypted
          </span>
          {activeConversation.kind === 'dm' ? (
            <>
              <button
                type="button"
                className="icon-button"
                onClick={() => void startCall(activeConversation, false)}
                disabled={!canCall}
                aria-label={`Audio call ${title}`}
                title={canCall ? 'Audio call' : 'Calls unlock after request is accepted'}
              >
                <Phone size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => void startCall(activeConversation, true)}
                disabled={!canCall}
                aria-label={`Video call ${title}`}
                title={canCall ? 'Video call' : 'Calls unlock after request is accepted'}
              >
                <Video size={19} aria-hidden="true" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="icon-button conversation__details-button"
            onClick={onOpenInfo}
            aria-label="Open conversation details"
            title="Details and members"
          >
            <PanelRightOpen size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="conversation__stream" ref={scrollRef}>
        <div className="ephemeral-banner">
          <Hourglass size={15} aria-hidden="true" />
          <span>
            Unread messages stay encrypted while you are away. After all recipients have read a
            message, it disappears after one minute.
          </span>
        </div>

        {!list.length ? (
          <div className="stream-empty">
            <MessageSquare size={22} aria-hidden="true" />
            <p>
              {isOutgoingPending
                ? `Send your first message to ${title}. They will receive a message request in their inbox.`
                : 'No active messages right now. Say hello below.'}
            </p>
          </div>
        ) : (
          <div className="message-list">
            {list.map((message, index) => {
              const previous = list[index - 1];
              const showSender =
                activeConversation.kind === 'group' &&
                !message.mine &&
                previous?.senderId !== message.senderId;
              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  showSender={showSender}
                  onOpenLink={setLinkToConfirm}
                />
              );
            })}
          </div>
        )}
      </div>

      {isIncomingPending ? (
        <div className="request-gate" role="region" aria-label="Message request actions">
          <div className="request-gate__copy">
            <ShieldCheck size={18} aria-hidden="true" />
            <div>
              <strong>Message request from {title}</strong>
              <p>
                This request does not expire. Accept to reply, share photos, and call, or remove it
                to delete the request and its queued messages.
              </p>
            </div>
          </div>
          <div className="request-gate__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={requestBusy}
              onClick={() => void handleAccept()}
            >
              {requestBusy ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <Check size={16} aria-hidden="true" />
              )}
              Accept request
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={requestBusy}
              onClick={() => void handleDecline()}
            >
              <Trash2 size={16} aria-hidden="true" /> Remove request
            </button>
          </div>
        </div>
      ) : (
        <>
          {isOutgoingPending ? (
            <div className="outgoing-request-bar">
              <span>
                Request to <strong>{handle}</strong> is pending with no expiry. Calls and file
                sharing unlock when accepted.
              </span>
              <button
                type="button"
                className="text-button text-button--danger"
                disabled={requestBusy}
                onClick={() => void handleDecline()}
              >
                Cancel request
              </button>
            </div>
          ) : null}
          <Composer allowAttachments={!isPending} enterToSend={enterToSend} />
        </>
      )}

      <LinkDialog link={linkToConfirm} onClose={() => setLinkToConfirm(null)} />
    </section>
  );
}
