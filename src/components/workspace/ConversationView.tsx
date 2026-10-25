import { useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Info,
  Lock,
  MessageCircle,
  Phone,
  ShieldCheck,
  Timer,
  Video,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';
import { useChat } from '../../context/ChatContext';
import { useToast } from '../../context/ToastContext';
import { conversationHandle, conversationSeed, conversationTitle } from '../../lib/format';
import type { Conversation } from '../../types';
import type { LinkAssessment } from '../../lib/links';
import { Avatar } from '../ui/Avatar';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';

export function ConversationView({
  conversation,
  onBack,
  onOpenInfo,
  onOpenLink,
}: {
  conversation: Conversation;
  onBack: () => void;
  onOpenInfo: () => void;
  onOpenLink: (link: LinkAssessment) => void;
}) {
  const { profile } = useAuth();
  const { messages, connection, sendText, sendFile } = useChat();
  const { startCall } = useCall();
  const { toast } = useToast();
  const myId = profile?.id ?? '';
  const title = conversationTitle(conversation, myId);
  const list = messages[conversation.id] ?? [];
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    stickToBottom.current = true;
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [conversation.id]);

  useEffect(() => {
    const element = listRef.current;
    if (!element || !stickToBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [list.length]);

  const beginCall = async (video: boolean) => {
    try {
      await startCall(conversation, video);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to start the call.', 'error');
    }
  };

  return (
    <section className="conversation-view" aria-label={`Conversation with ${title}`}>
      <header className="conversation-header">
        <button
          type="button"
          className="icon-button conversation-header__back"
          onClick={onBack}
          aria-label="Back to conversations"
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <Avatar
          name={title}
          seed={conversationSeed(conversation, myId)}
          group={conversation.kind === 'group'}
          size="small"
        />
        <div className="conversation-header__identity">
          <strong>{title}</strong>
          <span>{conversationHandle(conversation, myId)}</span>
        </div>
        <div className="conversation-header__security">
          <Lock size={13} aria-hidden="true" />
          <span>End-to-end encrypted</span>
        </div>
        <div className="conversation-header__actions">
          {conversation.kind === 'dm' ? (
            <>
              <button
                type="button"
                className="icon-button"
                onClick={() => void beginCall(false)}
                aria-label={`Start an audio call with ${title}`}
                title="Audio call"
              >
                <Phone size={19} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => void beginCall(true)}
                aria-label={`Start a video call with ${title}`}
                title="Video call"
              >
                <Video size={20} aria-hidden="true" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="icon-button"
            onClick={onOpenInfo}
            aria-label="Conversation details"
            title="Conversation details"
          >
            <Info size={19} aria-hidden="true" />
          </button>
        </div>
      </header>

      {connection !== 'connected' ? (
        <div
          className={`connection-banner${connection === 'offline' ? ' connection-banner--error' : ''}`}
        >
          {connection === 'offline' ? (
            <WifiOff size={15} aria-hidden="true" />
          ) : (
            <span className="status-dot" data-state="connecting" aria-hidden="true" />
          )}
          {connection === 'offline'
            ? 'You are offline. New messages cannot be delivered.'
            : 'Reconnecting to secure realtime…'}
        </div>
      ) : null}

      <div
        className="message-scroll"
        ref={listRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickToBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 90;
        }}
      >
        {!list.length ? (
          <div className="conversation-empty">
            <span className="conversation-empty__mark">
              <MessageCircle size={26} aria-hidden="true" />
            </span>
            <span className="eyebrow">A clean slate</span>
            <h2>Say what matters, then let it go.</h2>
            <p>
              Messages and files are encrypted in your browser and disappear two minutes after they
              are sent. Nothing is stored for later.
            </p>
            <div className="conversation-empty__rules">
              <span>
                <Timer size={16} aria-hidden="true" /> 2-minute lifetime
              </span>
              <span>
                <ShieldCheck size={16} aria-hidden="true" /> Browser-held keys
              </span>
              <span>
                <Lock size={16} aria-hidden="true" /> No archive
              </span>
            </div>
          </div>
        ) : (
          <div className="message-stack">
            {list.map((message, index) => {
              const previous = list[index - 1];
              const showSender =
                conversation.kind === 'group' &&
                !message.mine &&
                (!previous || previous.senderId !== message.senderId);
              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  showSender={showSender}
                  onOpenLink={onOpenLink}
                />
              );
            })}
          </div>
        )}
      </div>

      <Composer onSendText={sendText} onSendFile={sendFile} />
    </section>
  );
}
