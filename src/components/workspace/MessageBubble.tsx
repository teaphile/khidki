import { useEffect, useState } from 'react';
import type { ChatMessage } from '../../types';
import { assessLink, splitTextWithLinks } from '../../lib/links';
import type { LinkAssessment } from '../../lib/links';
import { formatBytes, isImageMime } from '../../lib/files';
import { formatClock, formatRemaining } from '../../lib/format';
import { Check, Clock3, Download, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';

function useRemaining(expiresAt: number): number {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));
  useEffect(() => {
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
            ) : (
              <div className="attachment__file">
                <span className="attachment__icon">
                  {isImageMime(attachment.mime) ? (
                    <ImageIcon size={19} aria-hidden="true" />
                  ) : (
                    <FileText size={19} aria-hidden="true" />
                  )}
                </span>
                <div className="attachment__details">
                  <strong title={attachment.name}>{attachment.name}</strong>
                  <span>
                    {formatBytes(attachment.size)}
                    {receiving ? ' · receiving' : ''}
                  </span>
                </div>
                {attachment.url ? (
                  <a
                    className="icon-button attachment__download"
                    href={attachment.url}
                    download={attachment.name}
                    aria-label={`Download ${attachment.name}`}
                    title="Download before it expires"
                  >
                    <Download size={18} aria-hidden="true" />
                  </a>
                ) : null}
              </div>
            )}

            {receiving ? (
              <div className="attachment__progress" aria-label="File transfer progress">
                <span style={{ width: `${attachment.progress ?? 0}%` }} />
              </div>
            ) : null}

            {image && attachment.url ? (
              <a
                className="attachment__download-row"
                href={attachment.url}
                download={attachment.name}
              >
                <Download size={15} aria-hidden="true" />
                <span>{formatBytes(attachment.size)}</span>
                <span>Download</span>
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="bubble__meta">
          <span>{formatClock(message.createdAt)}</span>
          <span className="bubble__timer" data-low={remaining <= 20_000}>
            <Clock3 size={11} aria-hidden="true" />
            {formatRemaining(remaining)}
          </span>
          {message.mine ? (
            <span className="bubble__status" aria-label={message.status}>
              {message.status === 'sending' ? (
                <Loader2 className="spin" size={12} aria-hidden="true" />
              ) : (
                <Check size={13} aria-hidden="true" />
              )}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
