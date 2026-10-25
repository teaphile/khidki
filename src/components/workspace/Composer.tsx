import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent } from 'react';
import { FileText, Image as ImageIcon, Loader2, Paperclip, Send, X } from 'lucide-react';
import { ACCEPTED_FILE_TYPES, formatBytes, inspectFile, MAX_FILE_BYTES } from '../../lib/files';
import { useToast } from '../../context/ToastContext';

type PendingFile = {
  file: File;
  name: string;
  size: number;
  mime: string;
  preview?: string;
};

export function Composer({
  onSendText,
  onSendFile,
  onTyping,
}: {
  onSendText: (text: string) => Promise<void>;
  onSendFile: (file: File, caption: string) => Promise<void>;
  onTyping?: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingFile | null>(null);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    return () => {
      if (pendingRef.current?.preview) URL.revokeObjectURL(pendingRef.current.preview);
    };
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 152)}px`;
  }, [draft]);

  const chooseFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast('Files are limited to 2 MB because they travel through realtime channels.', 'error');
      return;
    }
    const inspection = await inspectFile(file);
    if (!inspection.ok) {
      toast(inspection.error, 'error');
      return;
    }
    if (pending?.preview) URL.revokeObjectURL(pending.preview);
    const preview = inspection.mime.startsWith('image/') ? URL.createObjectURL(file) : undefined;
    setPending({
      file,
      name: inspection.name,
      size: file.size,
      mime: inspection.mime,
      preview,
    });
    textareaRef.current?.focus();
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void chooseFile(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void chooseFile(file);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = event.clipboardData.files?.[0];
    if (!file) return;
    event.preventDefault();
    void chooseFile(file);
  };

  const removePending = () => {
    if (pending?.preview) URL.revokeObjectURL(pending.preview);
    setPending(null);
  };

  const send = async () => {
    if (busy) return;
    const attachment = pending;
    const text = draft.trim();
    if (!attachment && !text) return;
    setBusy(true);
    try {
      if (attachment) {
        await onSendFile(attachment.file, text);
        if (attachment.preview) URL.revokeObjectURL(attachment.preview);
        setPending(null);
      } else {
        await onSendText(text);
      }
      setDraft('');
      textareaRef.current?.focus();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The message could not be sent.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };

  return (
    <div
      className={`composer${dragging ? ' composer--dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      {pending ? (
        <div className="attachment-tray">
          <div className="attachment-tray__preview">
            {pending.preview ? (
              <img src={pending.preview} alt="" />
            ) : (
              <span className="attachment-tray__icon">
                {pending.mime.startsWith('image/') ? (
                  <ImageIcon size={18} aria-hidden="true" />
                ) : (
                  <FileText size={18} aria-hidden="true" />
                )}
              </span>
            )}
          </div>
          <div className="attachment-tray__details">
            <strong>{pending.name}</strong>
            <span>{formatBytes(pending.size)} · expires with this message</span>
          </div>
          <button
            type="button"
            className="icon-button icon-button--small"
            onClick={removePending}
            aria-label="Remove attachment"
            disabled={busy}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="composer__row">
        <input
          ref={fileInputRef}
          type="file"
          className="visually-hidden"
          accept={ACCEPTED_FILE_TYPES}
          onChange={onFileChange}
          tabIndex={-1}
        />
        <button
          type="button"
          className="icon-button composer__attach"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach a file"
          title="Attach a file (max 2 MB)"
          disabled={busy}
        >
          <Paperclip size={20} aria-hidden="true" />
        </button>

        <div className="composer__field">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              onTyping?.();
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="Write a message…"
            aria-label="Message"
            rows={1}
            maxLength={4000}
          />
          <span className="composer__hint">Enter to send · Shift + Enter for a new line</span>
        </div>

        <button
          type="button"
          className="composer__send"
          onClick={() => void send()}
          disabled={busy || (!draft.trim() && !pending)}
          aria-label="Send message"
        >
          {busy ? (
            <Loader2 className="spin" size={19} aria-hidden="true" />
          ) : (
            <Send size={19} aria-hidden="true" />
          )}
        </button>
      </div>
      <div className="composer__meta">
        <span>Messages and files vanish after 2 minutes.</span>
        <span>{draft.length > 3500 ? `${draft.length}/4000` : 'Files up to 2 MB'}</span>
      </div>
    </div>
  );
}
