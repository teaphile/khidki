import { useEffect, useState } from 'react';
import type { ChatMessage } from '../../types';
import { assessLink, splitTextWithLinks } from '../../lib/links';
import type { LinkAssessment } from '../../lib/links';
import { formatBytes, isImageMime, isVideoMime } from '../../lib/files';
import { formatClock, formatRemaining } from '../../lib/format';
import {
  Check,
  CheckCheck,
  Hourglass,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Video as VideoIcon,
} from 'lucide-react';

function useRemaining(expiresAt: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(() =>
    expiresAt !== null ? Math.max(0, expiresAt - Date.now()) : null,
  );
  useEffect(() => {
    if (expiresAt === null) {
      setRemaining(null);
      return;
    }
    const update = () => setRemaining(Math.max(0, expiresAt - Date.now()));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  return remaining;
}

function MessageText({
  text,
  onOpenLink,
}: {
  text: string;
  onOpenLink: (link: LinkAssessment) => void;
}) {
  const parts = splitTextWithLinks(text);
  return (
    <span className="message-text">
      {parts.map((part, index) => {
        if (part.type === 'text') return <span key={`${index}-text`}>{part.value}</span>;
        return (
          <button
            key={`${index}-link`}
            type="button"
            className="message-link"
            title={part.href}
            onClick={() => {
              const assessment = assessLink(part.href);
              if (assessment) onOpenLink(assessment);
            }}
          >
            {part.label}
          </button>
        );
      })}
    </span>
  );
}

export function MessageBubble({
  message,
  showSender,
  onOpenLink,
}: {
  message: ChatMessage;
  showSender: boolean;
  onOpenLink: (link: LinkAssessment) => void;
}) {
  const remaining = useRemaining(message.expiresAt);
  const attachment = message.attachment;
  const receiving = message.status === 'receiving';
  const image = attachment ? isImageMime(attachment.mime) && Boolean(attachment.url) : false;
  const video = attachment ? isVideoMime(attachment.mime) && Boolean(attachment.url) : false;

  return (
    <article className={`message${message.mine ? ' message--mine' : ''}`}>
      <div className="bubble">
        {showSender && !message.mine ? (
          <span className="bubble__sender">{message.senderName}</span>
        ) : null}

        {message.text ? <MessageText text={message.text} onOpenLink={onOpenLink} /> : null}

        {attachment ? (
          <div className="attachment">
            {image && attachment.url ? (
              <a
                className="attachment__image"
                href={attachment.url}
                download={attachment.name}
                aria-label={`Download ${attachment.name}`}
              >
                <img
                  src={attachment.url}
                  alt={attachment.name}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              </a>
            ) : video && attachment.url ? (
              <div className="attachment__video">
                <video src={attachment.url} controls playsInline preload="metadata" />
              </div>
            ) : null}
            <div className="attachment__bar">
              <span className="attachment__icon">
                {receiving ? (
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                ) : isImageMime(attachment.mime) ? (
                  <ImageIcon size={17} aria-hidden="true" />
                ) : isVideoMime(attachment.mime) ? (
                  <VideoIcon size={17} aria-hidden="true" />
                ) : (
                  <FileText size={17} aria-hidden="true" />
                )}
              </span>
              <span className="attachment__meta">
                <strong className="truncate">{attachment.name}</strong>
                <span>
                  {formatBytes(attachment.size)}
                  {receiving && typeof attachment.progress === 'number'
                    ? ` · ${attachment.progress}%`
                    : ''}
                </span>
              </span>
              {attachment.url ? (
                <a
                  className="icon-button icon-button--small"
                  href={attachment.url}
                  download={attachment.name}
                  aria-label={`Save ${attachment.name}`}
                >
                  <Download size={16} aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </div>
        ) : null}

        <footer className="bubble__meta">
          <time>{formatClock(message.createdAt)}</time>
          {remaining !== null ? (
            <span
              className={`timer${remaining <= 20_000 ? ' timer--urgent' : ''}`}
              title="Auto-deletes when the reading timer reaches 0:00"
            >
              <Hourglass size={11} aria-hidden="true" />
              Auto-delete · {formatRemaining(remaining)}
            </span>
          ) : (
            <span
              className="timer timer--waiting"
              title="This message stays encrypted until the recipient reads it"
            >
              Waiting to be read
            </span>
          )}
          {message.mine ? (
            <span className="delivery" aria-label={message.status}>
              {message.status === 'sending' ? (
                <Loader2 className="spin" size={12} aria-hidden="true" />
              ) : message.seenAt !== null ? (
                <CheckCheck size={13} aria-hidden="true" />
              ) : (
                <Check size={12} aria-hidden="true" />
              )}
            </span>
          ) : null}
        </footer>
      </div>
    </article>
  );
}
