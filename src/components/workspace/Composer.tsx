import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { FileText, Image as ImageIcon, Loader2, Paperclip, Send, Video, X } from 'lucide-react';
import { useChat } from '../../context/ChatContext';
import { useToast } from '../../context/ToastContext';
import {
  ACCEPTED_FILE_TYPES,
  formatBytes,
  isImageMime,
  isVideoMime,
  MAX_FILE_BYTES,
  prepareAttachmentFile,
} from '../../lib/files';

export function Composer({
  allowAttachments = true,
  enterToSend = true,
}: {
  allowAttachments?: boolean;
  enterToSend?: boolean;
}) {
  const { activeId, sendText, sendFile } = useChat();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [preparingFile, setPreparingFile] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setText('');
    setFile(null);
    setPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  }, [activeId]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = '0px';
    node.style.height = `${Math.min(132, Math.max(24, node.scrollHeight))}px`;
  }, [text]);

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  };

  const onChooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setPreparingFile(true);
    try {
      const prepared = await prepareAttachmentFile(chosen);
      if (!prepared.ok) {
        toast(prepared.error, 'error');
        event.target.value = '';
        return;
      }
      setPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return isImageMime(prepared.mime) ? URL.createObjectURL(prepared.file) : null;
      });
      setFile(prepared.file);
    } finally {
      setPreparingFile(false);
    }
  };

  const submit = async () => {
    if (sending || preparingFile) return;
    const trimmed = text.trim();
    if (!trimmed && !file) return;

    setSending(true);
    try {
      if (file) {
        await sendFile(file, trimmed || undefined);
        clearFile();
        setText('');
      } else {
        await sendText(trimmed);
        setText('');
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The message could not be sent.', 'error');
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const isComposing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
    if (event.key === 'Enter' && enterToSend && !event.shiftKey && !isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form className="composer" onSubmit={onSubmit}>
      {file ? (
        <div className="composer__attachment">
          {previewUrl ? (
            <img src={previewUrl} alt="" className="composer__thumb" />
          ) : (
            <span className="composer__file-icon">
              {isImageMime(file.type) ? (
                <ImageIcon size={18} aria-hidden="true" />
              ) : isVideoMime(file.type) ? (
                <Video size={18} aria-hidden="true" />
              ) : (
                <FileText size={18} aria-hidden="true" />
              )}
            </span>
          )}
          <div className="composer__file-meta">
            <strong className="truncate">{file.name}</strong>
            <span>{formatBytes(file.size)} · Encrypted · Auto-deletes 1 minute after reading</span>
          </div>
          <button
            type="button"
            className="icon-button icon-button--small"
            onClick={clearFile}
            aria-label="Remove attachment"
            disabled={sending}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="composer__bar">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          onChange={(event) => void onChooseFile(event)}
          className="visually-hidden"
          tabIndex={-1}
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || preparingFile || !allowAttachments}
          aria-label="Attach photo or file"
          title={
            allowAttachments
              ? `Attach photo or file (up to ${formatBytes(MAX_FILE_BYTES)}, photos compress automatically)`
              : 'Attachments unlock after request is accepted'
          }
        >
          {preparingFile ? (
            <Loader2 className="spin" size={18} aria-hidden="true" />
          ) : (
            <Paperclip size={19} aria-hidden="true" />
          )}
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={4000}
          placeholder={file ? 'Add an optional caption...' : 'Write an encrypted message...'}
          aria-label="Message"
          disabled={sending}
        />

        <button
          type="submit"
          className="send-button"
          disabled={sending || preparingFile || (!text.trim() && !file)}
          aria-label="Send message"
        >
          {sending ? (
            <Loader2 className="spin" size={18} aria-hidden="true" />
          ) : (
            <Send size={17} aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
  );
}
