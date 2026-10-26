import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type {
  ChatMessage,
  Conversation,
  ConversationMember,
  Identity,
  PeopleResult,
  Profile,
} from '../types';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import {
  addGroupMember as addGroupMemberRequest,
  createGroup as createGroupRequest,
  fetchConversations,
  fetchWrappedKey,
  leaveGroup as leaveGroupRequest,
  removeGroupMember as removeGroupMemberRequest,
  renameGroup as renameGroupRequest,
  setConversationKeys,
  startDm,
} from '../lib/data';
import { generateConversationKey, unwrapConversationKey, wrapConversationKey } from '../lib/crypto';
import type { ChunkWire, FilePlain, MessageWire } from '../lib/messaging';
import {
  chunkPayloadSchema,
  clampExpiry,
  decryptChunkWire,
  decryptMessageWire,
  encryptChunkWire,
  encryptFileMetaWire,
  encryptTextWire,
  FILE_CHUNK_BYTES,
  MESSAGE_TTL_MS,
  messagePayloadSchema,
  verifyChunkWire,
  verifyMessageWire,
} from '../lib/messaging';
import { inspectFile } from '../lib/files';
import { messageTextSchema } from '../lib/validation';
import { requireSupabase } from '../lib/env';
import { closeOutboundChannels, sendUserEvent, setRealtimeSelfUserId } from '../lib/realtime';

type ConnectionState = 'connecting' | 'connected' | 'offline';
type UserEventHandler = (event: string, payload: unknown) => void;

type ChatContextValue = {
  conversations: Conversation[];
  conversationsLoading: boolean;
  conversationsError: string | null;
  activeId: string | null;
  activeConversation: Conversation | null;
  messages: Record<string, ChatMessage[]>;
  unread: Record<string, number>;
  connection: ConnectionState;
  setActiveId: (id: string | null) => void;
  refreshConversations: (silent?: boolean) => Promise<Conversation[]>;
  startDirectMessage: (person: PeopleResult) => Promise<string>;
  createGroupChat: (title: string, people: PeopleResult[]) => Promise<string>;
  sendText: (text: string) => Promise<void>;
  sendFile: (file: File, caption?: string) => Promise<void>;
  addGroupMember: (conversationId: string, username: string) => Promise<void>;
  removeGroupMember: (conversationId: string, userId: string) => Promise<void>;
  leaveGroupChat: (conversationId: string) => Promise<void>;
  renameGroupChat: (conversationId: string, title: string) => Promise<void>;
  sendUserEventTo: (
    userId: string,
    event: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  subscribeUserEvents: (handler: UserEventHandler) => () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

const USER_EVENTS = [
  'conversation-updated',
  'call-offer',
  'call-answer',
  'call-ice',
  'call-decline',
  'call-end',
];

const TRANSFER_EVENTS = ['message', 'file-meta', 'file-chunk', 'key-rotated'];
const MAX_ACTIVE_TRANSFERS = 8;
const MAX_MESSAGES_PER_CONVERSATION = 200;
const REPLAY_WINDOW_MS = MESSAGE_TTL_MS * 3;
const PEER_REFRESH_COOLDOWN_MS = 3_000;

type TransferState = {
  meta: FilePlain;
  wire: MessageWire;
  chunks: Array<Uint8Array | undefined>;
  received: number;
  createdAt: number;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function sortMessages(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((left, right) => left.createdAt - right.createdAt);
}

function ChatSession({
  profile,
  identity,
  children,
}: {
  profile: Profile;
  identity: Identity;
  children: ReactNode;
}) {
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [connection, setConnection] = useState<ConnectionState>(
    navigator.onLine ? 'connecting' : 'offline',
  );

  const conversationsRef = useRef<Conversation[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Record<string, ChatMessage[]>>({});
  const transferRef = useRef<Map<string, TransferState>>(new Map());
  const keysRef = useRef<Map<string, string>>(new Map());
  const seenIdsRef = useRef<Map<string, number>>(new Map());
  const lastPeerRefreshRef = useRef<number>(0);
  const channelsRef = useRef<Map<string, RealtimeChannel>>(new Map());
  const userChannelRef = useRef<RealtimeChannel | null>(null);
  const userListenersRef = useRef<Set<UserEventHandler>>(new Set());
  const refreshRef = useRef<(silent?: boolean) => Promise<Conversation[]>>(async () => []);
  const handleMessageRef = useRef<(conversationId: string, payload: unknown) => void>(() => {});
  const handleFileMetaRef = useRef<(conversationId: string, payload: unknown) => void>(() => {});
  const handleChunkRef = useRef<(conversationId: string, payload: unknown) => void>(() => {});
  const handleKeyRotatedRef = useRef<(conversationId: string) => void>(() => {});

  useEffect(() => {
    setRealtimeSelfUserId(profile.id);
    return () => {
      setRealtimeSelfUserId(null);
    };
  }, [profile.id]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const updateMessages = useCallback(
    (updater: (current: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>) => {
      setMessages((current) => {
        const next = updater(current);
        messagesRef.current = next;
        return next;
      });
    },
    [],
  );

  const setActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveIdState(id);
    if (id) {
      setUnread((current) => (current[id] ? { ...current, [id]: 0 } : current));
    }
  }, []);

  const refreshConversations = useCallback(async (silent = false): Promise<Conversation[]> => {
    if (!silent) {
      setConversationsLoading(true);
      setConversationsError(null);
    }
    try {
      const next = await fetchConversations();
      conversationsRef.current = next;
      setConversations(next);
      setConversationsError(null);
      const currentActive = activeIdRef.current;
      if (currentActive && !next.some((conversation) => conversation.id === currentActive)) {
        activeIdRef.current = null;
        setActiveIdState(null);
      }
      return next;
    } catch (error) {
      const message = errorMessage(error, 'Unable to load conversations.');
      if (!silent) setConversationsError(message);
      throw error;
    } finally {
      if (!silent) setConversationsLoading(false);
    }
  }, []);

  const findConversation = useCallback(
    (conversationId: string): Conversation | undefined =>
      conversationsRef.current.find((conversation) => conversation.id === conversationId),
    [],
  );

  const verifySenderMessage = useCallback(
    async (
      conversationId: string,
      wire: MessageWire,
    ): Promise<{ conversation: Conversation; member: ConversationMember } | null> => {
      let conversation = findConversation(conversationId);
      let member = conversation?.members.find((item) => item.userId === wire.senderId);
      if (conversation && member?.publicKey && (await verifyMessageWire(wire, member.publicKey))) {
        return { conversation, member };
      }

      const now = Date.now();
      if (now - lastPeerRefreshRef.current < PEER_REFRESH_COOLDOWN_MS) return null;
      lastPeerRefreshRef.current = now;

      const refreshed = await refreshConversations(true).catch(() => null);
      conversation = refreshed?.find((item) => item.id === conversationId);
      member = conversation?.members.find((item) => item.userId === wire.senderId);
      if (conversation && member?.publicKey && (await verifyMessageWire(wire, member.publicKey))) {
        return { conversation, member };
      }
      return null;
    },
    [findConversation, refreshConversations],
  );

  const unwrapKeyRow = useCallback(
    async (conversationId: string): Promise<string | null> => {
      const row = await fetchWrappedKey(conversationId);
      if (!row) return null;
      try {
        const key = await unwrapConversationKey(
          row.wrapped_key,
          row.wrap_iv,
          identity.ecdh.privateKey,
          row.from_public_key.ecdh,
          conversationId,
        );
        keysRef.current.set(conversationId, key);
        return key;
      } catch {
        return null;
      }
    },
    [identity.ecdh.privateKey],
  );

  const sendConversationEvent = useCallback(
    async (
      conversationId: string,
      event: string,
      payload: Record<string, unknown>,
    ): Promise<void> => {
      const channel = channelsRef.current.get(conversationId);
      if (!channel) throw new Error('This conversation is not connected yet.');
      for (let attempt = 0; attempt < 60 && channel.state !== 'joined'; attempt += 1) {
        await delay(100);
      }
      if (channel.state !== 'joined') throw new Error('The realtime connection is not ready.');
      const result = await channel.send({ type: 'broadcast', event, payload });
      if (result !== 'ok') throw new Error('The message could not be sent.');
    },
    [],
  );

  const rotateConversationKey = useCallback(
    async (conversation: Conversation, members = conversation.members): Promise<string> => {
      const key = generateConversationKey();
      const keys: Array<{ user_id: string; wrapped_key: string; wrap_iv: string }> = [];

      for (const member of members) {
        if (!member.publicKey) continue;
        try {
          const wrapped = await wrapConversationKey(
            key,
            identity.ecdh.privateKey,
            member.publicKey.ecdh,
            conversation.id,
          );
          keys.push({
            user_id: member.userId,
            wrapped_key: wrapped.wrappedKey,
            wrap_iv: wrapped.iv,
          });
        } catch {
          // A malformed peer key must not block the whole conversation.
        }
      }

      const includesMe = keys.some((item) => item.user_id === profile.id);
      if (!includesMe) throw new Error('Unable to prepare encryption for this conversation.');
      if (conversation.kind === 'dm' && keys.length < 2) {
        throw new Error('This person has not completed secure setup yet.');
      }

      await setConversationKeys(conversation.id, keys);
      keysRef.current.set(conversation.id, key);
      void sendConversationEvent(conversation.id, 'key-rotated', {
        senderId: profile.id,
      }).catch(() => undefined);
      return key;
    },
    [identity, profile.id, sendConversationEvent],
  );

  const ensureKeyForSend = useCallback(
    async (conversation: Conversation): Promise<string> => {
      const cached = keysRef.current.get(conversation.id);
      if (cached) return cached;
      const loaded = await unwrapKeyRow(conversation.id);
      if (loaded) return loaded;
      return rotateConversationKey(conversation);
    },
    [rotateConversationKey, unwrapKeyRow],
  );

  const loadKeyForReceive = useCallback(
    async (conversationId: string, force = false): Promise<string | null> => {
      const cached = keysRef.current.get(conversationId);
      if (cached && !force) return cached;
      return unwrapKeyRow(conversationId);
    },
    [unwrapKeyRow],
  );

  const markMessage = useCallback(
    (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => {
      updateMessages((current) => {
        const list = current[conversationId];
        if (!list) return current;
        let changed = false;
        const next = list.map((message) => {
          if (message.id !== messageId) return message;
          changed = true;
          return { ...message, ...patch };
        });
        return changed ? { ...current, [conversationId]: next } : current;
      });
    },
    [updateMessages],
  );

  const removeMessage = useCallback(
    (conversationId: string, messageId: string) => {
      let url: string | undefined;
      updateMessages((current) => {
        const list = current[conversationId];
        if (!list) return current;
        const target = list.find((message) => message.id === messageId);
        url = target?.attachment?.url;
        const next = list.filter((message) => message.id !== messageId);
        if (next.length === list.length) return current;
        return { ...current, [conversationId]: next };
      });
      if (url) URL.revokeObjectURL(url);
      transferRef.current.delete(`${conversationId}:${messageId}`);
    },
    [updateMessages],
  );

  const appendMessageBounded = useCallback(
    (conversationId: string, message: ChatMessage) => {
      let evictedUrls: string[] = [];
      updateMessages((current) => {
        const list = current[conversationId] ?? [];
        if (list.some((existing) => existing.id === message.id)) return current;
        const sorted = sortMessages([...list, message]);
        if (sorted.length > MAX_MESSAGES_PER_CONVERSATION) {
          const overflow = sorted.slice(0, sorted.length - MAX_MESSAGES_PER_CONVERSATION);
          evictedUrls = overflow
            .map((item) => item.attachment?.url)
            .filter((url): url is string => Boolean(url));
          return {
            ...current,
            [conversationId]: sorted.slice(sorted.length - MAX_MESSAGES_PER_CONVERSATION),
          };
        }
        return { ...current, [conversationId]: sorted };
      });
      for (const url of evictedUrls) URL.revokeObjectURL(url);
    },
    [updateMessages],
  );

  const addIncomingMessage = useCallback(
    (
      conversation: Conversation,
      member: ConversationMember,
      wire: MessageWire,
      text?: string,
      attachment?: ChatMessage['attachment'],
    ) => {
      const expiresAt = clampExpiry(wire.createdAt);
      if (expiresAt <= Date.now()) return;

      const message: ChatMessage = {
        id: wire.id,
        conversationId: conversation.id,
        senderId: wire.senderId,
        senderName: member.displayName,
        kind: wire.kind,
        text,
        attachment,
        createdAt: wire.createdAt,
        expiresAt,
        status: 'sent',
        mine: false,
      };
      appendMessageBounded(conversation.id, message);

      if (activeIdRef.current !== conversation.id) {
        setUnread((current) => ({
          ...current,
          [conversation.id]: (current[conversation.id] ?? 0) + 1,
        }));
      }
    },
    [appendMessageBounded],
  );

  const handleMessage = useCallback(
    (conversationId: string, payload: unknown) => {
      void (async () => {
        const parsed = messagePayloadSchema.safeParse(payload);
        if (!parsed.success || parsed.data.kind !== 'text') return;
        const wire = parsed.data;
        if (wire.conversationId !== conversationId) return;

        const replayKey = `${conversationId}:${wire.id}`;
        if (seenIdsRef.current.has(replayKey)) return;

        const verified = await verifySenderMessage(conversationId, wire);
        if (!verified) return;
        seenIdsRef.current.set(replayKey, Date.now());

        const key = await loadKeyForReceive(conversationId);
        if (!key) return;

        let plaintext: Awaited<ReturnType<typeof decryptMessageWire>>;
        try {
          plaintext = await decryptMessageWire(wire, key);
        } catch {
          const refreshed = await loadKeyForReceive(conversationId, true);
          if (!refreshed) return;
          try {
            plaintext = await decryptMessageWire(wire, refreshed);
          } catch {
            if (activeIdRef.current === conversationId) {
              toast('A message could not be decrypted and was discarded.', 'error');
            }
            return;
          }
        }

        if (!('text' in plaintext)) return;
        addIncomingMessage(verified.conversation, verified.member, wire, plaintext.text);
      })();
    },
    [addIncomingMessage, loadKeyForReceive, toast, verifySenderMessage],
  );

  const handleFileMeta = useCallback(
    (conversationId: string, payload: unknown) => {
      void (async () => {
        if (transferRef.current.size >= MAX_ACTIVE_TRANSFERS) return;
        const parsed = messagePayloadSchema.safeParse(payload);
        if (!parsed.success || parsed.data.kind !== 'file') return;
        const wire = parsed.data;
        if (wire.conversationId !== conversationId) return;

        const replayKey = `${conversationId}:${wire.id}`;
        if (seenIdsRef.current.has(replayKey)) return;

        const verified = await verifySenderMessage(conversationId, wire);
        if (!verified) return;
        seenIdsRef.current.set(replayKey, Date.now());

        const key = await loadKeyForReceive(conversationId);
        if (!key) return;

        let plaintext: Awaited<ReturnType<typeof decryptMessageWire>>;
        try {
          plaintext = await decryptMessageWire(wire, key);
        } catch {
          const refreshed = await loadKeyForReceive(conversationId, true);
          if (!refreshed) return;
          try {
            plaintext = await decryptMessageWire(wire, refreshed);
          } catch {
            return;
          }
        }
        if (!('name' in plaintext)) return;
        const meta = plaintext;
        if (Math.ceil(meta.size / meta.chunkSize) !== meta.chunks) return;

        const expiresAt = clampExpiry(wire.createdAt);
        if (expiresAt <= Date.now()) return;

        transferRef.current.set(`${conversationId}:${wire.id}`, {
          meta,
          wire,
          chunks: new Array(meta.chunks),
          received: 0,
          createdAt: wire.createdAt,
        });

        const attachment: ChatMessage['attachment'] = {
          id: wire.id,
          name: meta.name,
          mime: meta.mime,
          size: meta.size,
          progress: 0,
        };
        addIncomingMessage(verified.conversation, verified.member, wire, meta.caption, attachment);
        markMessage(conversationId, wire.id, { status: 'receiving' });
      })();
    },
    [addIncomingMessage, loadKeyForReceive, markMessage, verifySenderMessage],
  );

  const finishTransfer = useCallback(
    async (conversationId: string, messageId: string, transfer: TransferState) => {
      const parts = transfer.chunks.filter((part): part is Uint8Array<ArrayBuffer> =>
        Boolean(part),
      );
      if (parts.length !== transfer.meta.chunks) return;
      const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
      if (total !== transfer.meta.size) {
        removeMessage(conversationId, messageId);
        toast('A file transfer was discarded because its size was invalid.', 'error');
        return;
      }

      const blob = new Blob(parts, { type: transfer.meta.mime });
      const candidate = new File([blob], transfer.meta.name, { type: transfer.meta.mime });
      const inspection = await inspectFile(candidate);
      if (!inspection.ok) {
        removeMessage(conversationId, messageId);
        toast('A file was discarded because its contents did not match its type.', 'error');
        return;
      }

      const url = URL.createObjectURL(blob);
      markMessage(conversationId, messageId, {
        status: 'sent',
        attachment: {
          id: messageId,
          name: inspection.name,
          mime: inspection.mime,
          size: total,
          url,
          progress: 100,
        },
      });
      transferRef.current.delete(`${conversationId}:${messageId}`);
    },
    [markMessage, removeMessage, toast],
  );

  const handleChunk = useCallback(
    (conversationId: string, payload: unknown) => {
      void (async () => {
        const conversation = findConversation(conversationId);
        if (!conversation) return;
        const parsed = chunkPayloadSchema.safeParse(payload);
        if (!parsed.success) return;
        const wire: ChunkWire = parsed.data;
        if (wire.conversationId !== conversationId) return;
        const transfer = transferRef.current.get(`${conversationId}:${wire.messageId}`);
        if (!transfer) return;
        if (wire.index >= transfer.meta.chunks) return;
        if (transfer.chunks[wire.index]) return;
        if (
          wire.senderId !== transfer.wire.senderId ||
          wire.createdAt !== transfer.wire.createdAt
        ) {
          return;
        }
        const member = conversation.members.find((item) => item.userId === wire.senderId);
        if (!member?.publicKey) return;
        if (!(await verifyChunkWire(wire, member.publicKey))) return;

        const key = await loadKeyForReceive(conversationId);
        if (!key) return;
        let bytes: Uint8Array<ArrayBuffer>;
        try {
          bytes = await decryptChunkWire(wire, key);
        } catch {
          const refreshed = await loadKeyForReceive(conversationId, true);
          if (!refreshed) return;
          try {
            bytes = await decryptChunkWire(wire, refreshed);
          } catch {
            return;
          }
        }

        if (bytes.byteLength > transfer.meta.chunkSize) {
          removeMessage(conversationId, wire.messageId);
          return;
        }
        transfer.chunks[wire.index] = bytes;
        transfer.received += 1;
        const assembled = transfer.chunks.reduce((sum, part) => sum + (part?.byteLength ?? 0), 0);
        markMessage(conversationId, wire.messageId, {
          attachment: {
            id: wire.messageId,
            name: transfer.meta.name,
            mime: transfer.meta.mime,
            size: transfer.meta.size,
            progress: Math.min(99, Math.round((assembled / transfer.meta.size) * 100)),
          },
        });

        if (transfer.received === transfer.meta.chunks) {
          await finishTransfer(conversationId, wire.messageId, transfer);
        }
      })();
    },
    [findConversation, finishTransfer, loadKeyForReceive, markMessage, removeMessage],
  );

  const handleKeyRotated = useCallback(
    (conversationId: string) => {
      keysRef.current.delete(conversationId);
      const now = Date.now();
      if (now - lastPeerRefreshRef.current >= PEER_REFRESH_COOLDOWN_MS) {
        lastPeerRefreshRef.current = now;
        void refreshConversations(true).catch(() => undefined);
      }
    },
    [refreshConversations],
  );

  useEffect(() => {
    refreshRef.current = refreshConversations;
    handleMessageRef.current = handleMessage;
    handleFileMetaRef.current = handleFileMeta;
    handleChunkRef.current = handleChunk;
    handleKeyRotatedRef.current = handleKeyRotated;
  }, [refreshConversations, handleMessage, handleFileMeta, handleChunk, handleKeyRotated]);

  const sendText = useCallback(
    async (rawText: string): Promise<void> => {
      const conversation = activeIdRef.current ? findConversation(activeIdRef.current) : undefined;
      if (!conversation) throw new Error('Choose a conversation first.');
      const text = messageTextSchema.parse(rawText);
      const key = await ensureKeyForSend(conversation);
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const wire = await encryptTextWire({
        key,
        id,
        conversationId: conversation.id,
        senderId: profile.id,
        text,
        createdAt,
        signPrivateKey: identity.sig.privateKey,
      });

      const optimistic: ChatMessage = {
        id,
        conversationId: conversation.id,
        senderId: profile.id,
        senderName: profile.display_name,
        kind: 'text',
        text,
        createdAt,
        expiresAt: createdAt + MESSAGE_TTL_MS,
        status: 'sending',
        mine: true,
      };
      appendMessageBounded(conversation.id, optimistic);

      try {
        await sendConversationEvent(conversation.id, 'message', wire);
        markMessage(conversation.id, id, { status: 'sent' });
      } catch (error) {
        removeMessage(conversation.id, id);
        throw error;
      }
    },
    [
      appendMessageBounded,
      ensureKeyForSend,
      findConversation,
      identity.sig.privateKey,
      markMessage,
      profile.display_name,
      profile.id,
      removeMessage,
      sendConversationEvent,
    ],
  );

  const sendFile = useCallback(
    async (file: File, rawCaption = ''): Promise<void> => {
      const conversation = activeIdRef.current ? findConversation(activeIdRef.current) : undefined;
      if (!conversation) throw new Error('Choose a conversation first.');
      const inspection = await inspectFile(file);
      if (!inspection.ok) throw new Error(inspection.error);
      const caption = rawCaption.trim();
      if (caption.length > 4000) throw new Error('Captions are limited to 4,000 characters.');

      const key = await ensureKeyForSend(conversation);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const chunkSize = FILE_CHUNK_BYTES;
      const chunks = Math.ceil(bytes.byteLength / chunkSize);
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const localUrl = URL.createObjectURL(file);

      const meta: FilePlain = {
        name: inspection.name,
        mime: inspection.mime,
        size: bytes.byteLength,
        chunks,
        chunkSize,
        caption: caption || undefined,
      };
      const wire = await encryptFileMetaWire({
        key,
        id,
        conversationId: conversation.id,
        senderId: profile.id,
        file: meta,
        createdAt,
        signPrivateKey: identity.sig.privateKey,
      });

      const optimistic: ChatMessage = {
        id,
        conversationId: conversation.id,
        senderId: profile.id,
        senderName: profile.display_name,
        kind: 'file',
        text: caption || undefined,
        attachment: {
          id,
          name: inspection.name,
          mime: inspection.mime,
          size: bytes.byteLength,
          url: localUrl,
          progress: 0,
        },
        createdAt,
        expiresAt: createdAt + MESSAGE_TTL_MS,
        status: 'sending',
        mine: true,
      };
      appendMessageBounded(conversation.id, optimistic);

      try {
        await sendConversationEvent(conversation.id, 'file-meta', wire);
        for (let index = 0; index < chunks; index += 1) {
          const slice = bytes.subarray(index * chunkSize, (index + 1) * chunkSize);
          const chunk = await encryptChunkWire({
            key,
            messageId: id,
            conversationId: conversation.id,
            senderId: profile.id,
            createdAt,
            index,
            bytes: slice,
            signPrivateKey: identity.sig.privateKey,
          });
          await sendConversationEvent(conversation.id, 'file-chunk', chunk);
          markMessage(conversation.id, id, {
            attachment: {
              id,
              name: inspection.name,
              mime: inspection.mime,
              size: bytes.byteLength,
              url: localUrl,
              progress: Math.min(99, Math.round(((index + 1) / chunks) * 100)),
            },
          });
          if (index + 1 < chunks) await delay(35);
        }
        markMessage(conversation.id, id, { status: 'sent' });
      } catch (error) {
        removeMessage(conversation.id, id);
        URL.revokeObjectURL(localUrl);
        throw error;
      }
    },
    [
      appendMessageBounded,
      ensureKeyForSend,
      findConversation,
      identity.sig.privateKey,
      markMessage,
      profile.display_name,
      profile.id,
      removeMessage,
      sendConversationEvent,
    ],
  );

  const sendUserEventTo = useCallback(
    async (userId: string, event: string, payload: Record<string, unknown>): Promise<void> => {
      await sendUserEvent(userId, event, payload);
    },
    [],
  );

  const subscribeUserEvents = useCallback((handler: UserEventHandler) => {
    userListenersRef.current.add(handler);
    return () => {
      userListenersRef.current.delete(handler);
    };
  }, []);

  const notifyPeers = useCallback(
    async (userIds: Iterable<string>) => {
      const targets = [...new Set(userIds)].filter((id) => id && id !== profile.id);
      await Promise.allSettled(
        targets.map((userId) =>
          sendUserEvent(userId, 'conversation-updated', {}).catch(() => undefined),
        ),
      );
    },
    [profile.id],
  );

  const startDirectMessage = useCallback(
    async (person: PeopleResult): Promise<string> => {
      const id = await startDm(person.username);
      const next = await refreshConversations(true);
      const conversation = next.find((item) => item.id === id);
      if (conversation) {
        const existingKey = await unwrapKeyRow(id).catch(() => null);
        if (!existingKey) {
          await rotateConversationKey(conversation).catch(() => undefined);
        }
      }
      setActiveId(id);
      void notifyPeers([person.id]);
      return id;
    },
    [notifyPeers, refreshConversations, rotateConversationKey, setActiveId, unwrapKeyRow],
  );

  const createGroupChat = useCallback(
    async (title: string, people: PeopleResult[]): Promise<string> => {
      const cleanTitle = title.trim();
      if (!cleanTitle) throw new Error('Add a group name.');
      if (!people.length) throw new Error('Add at least one other person.');
      const id = await createGroupRequest(
        cleanTitle,
        people.map((person) => person.username),
      );
      const next = await refreshConversations(true);
      const conversation = next.find((item) => item.id === id);
      if (conversation) {
        await rotateConversationKey(conversation).catch(() => undefined);
      }
      setActiveId(id);
      await notifyPeers(people.map((person) => person.id));
      return id;
    },
    [notifyPeers, refreshConversations, rotateConversationKey, setActiveId],
  );

  const addGroupMember = useCallback(
    async (conversationId: string, username: string): Promise<void> => {
      const userId = await addGroupMemberRequest(conversationId, username);
      const next = await refreshConversations(true);
      const conversation = next.find((item) => item.id === conversationId);
      if (conversation) {
        try {
          await rotateConversationKey(conversation);
        } catch (error) {
          toast(errorMessage(error, 'The group key could not be refreshed.'), 'error');
        }
        await notifyPeers([userId, ...conversation.members.map((member) => member.userId)]);
      } else {
        void notifyPeers([userId]);
      }
    },
    [notifyPeers, refreshConversations, rotateConversationKey, toast],
  );

  const removeGroupMember = useCallback(
    async (conversationId: string, userId: string): Promise<void> => {
      const existing = findConversation(conversationId);
      await removeGroupMemberRequest(conversationId, userId);
      const remaining = existing?.members.filter((member) => member.userId !== userId) ?? [];
      if (existing && remaining.length > 0) {
        try {
          await rotateConversationKey(existing, remaining);
        } catch (error) {
          toast(errorMessage(error, 'The group key could not be refreshed.'), 'error');
        }
      }
      await refreshConversations(true);
      await notifyPeers([userId, ...remaining.map((member) => member.userId)]);
    },
    [findConversation, notifyPeers, refreshConversations, rotateConversationKey, toast],
  );

  const leaveGroupChat = useCallback(
    async (conversationId: string): Promise<void> => {
      const existing = findConversation(conversationId);
      const remaining = existing?.members.filter((member) => member.userId !== profile.id) ?? [];
      if (existing && remaining.length > 0) {
        try {
          await rotateConversationKey(existing, remaining);
        } catch {
          // Leaving must remain possible even if key rotation fails.
        }
      }
      await leaveGroupRequest(conversationId);
      keysRef.current.delete(conversationId);
      if (activeIdRef.current === conversationId) setActiveId(null);
      await refreshConversations(true);
      await notifyPeers(remaining.map((member) => member.userId));
    },
    [
      findConversation,
      notifyPeers,
      profile.id,
      refreshConversations,
      rotateConversationKey,
      setActiveId,
    ],
  );

  const renameGroupChat = useCallback(
    async (conversationId: string, title: string): Promise<void> => {
      const existing = findConversation(conversationId);
      await renameGroupRequest(conversationId, title.trim());
      await refreshConversations(true);
      if (existing) {
        await notifyPeers(existing.members.map((member) => member.userId));
      }
    },
    [findConversation, notifyPeers, refreshConversations],
  );

  useEffect(() => {
    void refreshConversations().catch(() => undefined);
  }, [refreshConversations]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshConversations(true).catch(() => undefined);
    }, 25_000);
    const onFocus = () => {
      void refreshConversations(true).catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshConversations]);

  useEffect(() => {
    let channel = requireSupabase().channel(`user:${profile.id}`, {
      config: { private: true, broadcast: { self: false, ack: true } },
    });
    userChannelRef.current = channel;

    for (const event of USER_EVENTS) {
      channel = channel.on('broadcast', { event }, ({ payload }) => {
        if (event === 'conversation-updated') {
          void refreshRef.current(true).catch(() => undefined);
        }
        for (const listener of userListenersRef.current) {
          listener(event, payload);
        }
      });
    }

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') setConnection(navigator.onLine ? 'connected' : 'offline');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setConnection(navigator.onLine ? 'connecting' : 'offline');
      }
    });

    return () => {
      userChannelRef.current = null;
      void requireSupabase().removeChannel(channel);
    };
  }, [profile.id]);

  useEffect(() => {
    const onOnline = () => {
      setConnection(userChannelRef.current?.state === 'joined' ? 'connected' : 'connecting');
      void refreshRef.current(true).catch(() => undefined);
    };
    const onOffline = () => setConnection('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const conversationIds = conversations
    .map((conversation) => conversation.id)
    .sort()
    .join('|');

  useEffect(() => {
    const ids = new Set(conversationIds ? conversationIds.split('|') : []);
    for (const conversationId of ids) {
      if (channelsRef.current.has(conversationId)) continue;
      let channel = requireSupabase().channel(`conversation:${conversationId}`, {
        config: { private: true, broadcast: { self: false, ack: true } },
      });
      for (const event of TRANSFER_EVENTS) {
        channel = channel.on('broadcast', { event }, ({ payload }) => {
          if (event === 'message') handleMessageRef.current(conversationId, payload);
          if (event === 'file-meta') handleFileMetaRef.current(conversationId, payload);
          if (event === 'file-chunk') handleChunkRef.current(conversationId, payload);
          if (event === 'key-rotated') handleKeyRotatedRef.current(conversationId);
        });
      }
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') keysRef.current.delete(conversationId);
      });
      channelsRef.current.set(conversationId, channel);
    }

    for (const [conversationId, channel] of channelsRef.current) {
      if (ids.has(conversationId)) continue;
      channelsRef.current.delete(conversationId);
      keysRef.current.delete(conversationId);
      void requireSupabase().removeChannel(channel);
    }
  }, [conversationIds]);

  useEffect(() => {
    // These maps are created once and only mutated, so capturing them at mount
    // is safe and lets the cleanup read the latest contents.
    const channels = channelsRef.current;
    const transfers = transferRef.current;
    const keys = keysRef.current;
    const seen = seenIdsRef.current;
    const messageState = messagesRef.current;
    return () => {
      for (const channel of channels.values()) {
        void requireSupabase().removeChannel(channel);
      }
      channels.clear();
      void closeOutboundChannels();
      for (const list of Object.values(messageState)) {
        for (const message of list) {
          if (message.attachment?.url) URL.revokeObjectURL(message.attachment.url);
        }
      }
      transfers.clear();
      keys.clear();
      seen.clear();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const revoked: string[] = [];
      updateMessages((current) => {
        let changed = false;
        const next: Record<string, ChatMessage[]> = {};
        for (const [conversationId, list] of Object.entries(current)) {
          const kept = list.filter((message) => {
            if (message.expiresAt > now) return true;
            changed = true;
            if (message.attachment?.url) revoked.push(message.attachment.url);
            transferRef.current.delete(`${conversationId}:${message.id}`);
            return false;
          });
          next[conversationId] = kept;
        }
        return changed ? next : current;
      });
      for (const url of revoked) URL.revokeObjectURL(url);
      for (const [key, transfer] of transferRef.current) {
        if (transfer.createdAt + MESSAGE_TTL_MS <= now) {
          transferRef.current.delete(key);
        }
      }
      for (const [key, seenAt] of seenIdsRef.current) {
        if (now - seenAt > REPLAY_WINDOW_MS) {
          seenIdsRef.current.delete(key);
        }
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [updateMessages]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );

  useEffect(() => {
    const conversation = activeConversation;
    if (!conversation || keysRef.current.has(conversation.id)) return;
    let active = true;
    void (async () => {
      const row = await fetchWrappedKey(conversation.id).catch(() => null);
      if (!active || !row) return;
      const loaded = await unwrapKeyRow(conversation.id).catch(() => null);
      if (!active || loaded) return;
      await rotateConversationKey(conversation).catch(() => undefined);
    })();
    return () => {
      active = false;
    };
  }, [activeConversation, rotateConversationKey, unwrapKeyRow]);

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations,
      conversationsLoading,
      conversationsError,
      activeId,
      activeConversation,
      messages,
      unread,
      connection,
      setActiveId,
      refreshConversations,
      startDirectMessage,
      createGroupChat,
      sendText,
      sendFile,
      addGroupMember,
      removeGroupMember,
      leaveGroupChat,
      renameGroupChat,
      sendUserEventTo,
      subscribeUserEvents,
    }),
    [
      conversations,
      conversationsLoading,
      conversationsError,
      activeId,
      activeConversation,
      messages,
      unread,
      connection,
      setActiveId,
      refreshConversations,
      startDirectMessage,
      createGroupChat,
      sendText,
      sendFile,
      addGroupMember,
      removeGroupMember,
      leaveGroupChat,
      renameGroupChat,
      sendUserEventTo,
      subscribeUserEvents,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { profile, identity } = useAuth();
  if (!profile || !identity) return null;
  return (
    <ChatSession profile={profile} identity={identity}>
      {children}
    </ChatSession>
  );
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used inside ChatProvider.');
  return context;
}
