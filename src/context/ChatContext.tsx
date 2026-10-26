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
  StoredMessageRow,
} from '../types';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import {
  acceptMessageRequest,
  addGroupMember as addGroupMemberRequest,
  createGroup as createGroupRequest,
  declineMessageRequest,
  fetchConversations,
  fetchStoredMessages,
  fetchWrappedKey,
  leaveGroup as leaveGroupRequest,
  markConversationSeen,
  purgeExpiredMessages,
  removeGroupMember as removeGroupMemberRequest,
  renameGroup as renameGroupRequest,
  sendEncryptedMessage,
  setConversationKeys,
  startDm,
} from '../lib/data';
import type { SeenMessageReceipt } from '../lib/data';
import {
  generateConversationKey,
  randomId,
  unwrapConversationKey,
  wrapConversationKey,
} from '../lib/crypto';
import {
  packStoredFileMessage,
  packStoredTextMessage,
  resolveSeenTimers,
  unpackStoredMessage,
} from '../lib/messaging';
import { prepareAttachmentFile } from '../lib/files';
import { messageTextSchema } from '../lib/validation';
import { requireSupabase } from '../lib/env';
import { closeOutboundChannels, sendUserEvent, setRealtimeSelfUserId } from '../lib/realtime';

type ConnectionState = 'connecting' | 'connected' | 'offline';
type UserEventHandler = (event: string, payload: unknown) => void;

type ChatContextValue = {
  conversations: Conversation[];
  activeChats: Conversation[];
  incomingRequests: Conversation[];
  conversationsLoading: boolean;
  conversationsError: string | null;
  activeId: string | null;
  activeConversation: Conversation | null;
  messages: Record<string, ChatMessage[]>;
  unread: Record<string, number>;
  totalUnreadChats: number;
  incomingRequestCount: number;
  connection: ConnectionState;
  setActiveId: (id: string | null) => void;
  refreshConversations: (silent?: boolean) => Promise<Conversation[]>;
  startDirectMessage: (person: PeopleResult) => Promise<string>;
  acceptRequest: (conversationId: string) => Promise<void>;
  declineRequest: (conversationId: string) => Promise<void>;
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
  'messages-seen',
  'call-offer',
  'call-answer',
  'call-ice',
  'call-decline',
  'call-end',
];

const CONVERSATION_EVENTS = ['message-stored', 'messages-seen', 'key-rotated'];
const MAX_MESSAGES_PER_CONVERSATION = 200;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function sortMessages(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((left, right) => left.createdAt - right.createdAt);
}

function isIncomingRequest(conversation: Conversation, myId: string): boolean {
  return (
    conversation.kind === 'dm' &&
    conversation.requestStatus === 'pending' &&
    conversation.requestedBy !== null &&
    conversation.requestedBy !== myId
  );
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
  const [connection, setConnection] = useState<ConnectionState>(
    navigator.onLine ? 'connecting' : 'offline',
  );

  const conversationsRef = useRef<Conversation[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Record<string, ChatMessage[]>>({});
  const keysRef = useRef<Map<string, string>>(new Map());
  const decryptedRef = useRef<Map<string, ChatMessage>>(new Map());
  const channelsRef = useRef<Map<string, RealtimeChannel>>(new Map());
  const userChannelRef = useRef<RealtimeChannel | null>(null);
  const userListenersRef = useRef<Set<UserEventHandler>>(new Set());
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const syncQueuedRef = useRef(false);
  const markingSeenRef = useRef<Set<string>>(new Set());
  const lastServerPurgeRef = useRef(0);
  const purgeTimeoutRef = useRef<number | null>(null);

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
  }, []);

  const findConversation = useCallback(
    (conversationId: string): Conversation | undefined =>
      conversationsRef.current.find((conversation) => conversation.id === conversationId),
    [],
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

  const broadcastConversationEvent = useCallback(
    async (conversationId: string, event: string, payload: Record<string, unknown>) => {
      const channel = channelsRef.current.get(conversationId);
      if (!channel || channel.state !== 'joined') return;
      await channel.send({ type: 'broadcast', event, payload }).catch(() => undefined);
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
          // Skip malformed peer keys safely.
        }
      }

      const includesMe = keys.some((item) => item.user_id === profile.id);
      if (!includesMe) throw new Error('Unable to prepare encryption for this conversation.');
      if (conversation.kind === 'dm' && keys.length < 2) {
        throw new Error('This person has not completed secure setup yet.');
      }

      await setConversationKeys(conversation.id, keys);
      keysRef.current.set(conversation.id, key);
      void broadcastConversationEvent(conversation.id, 'key-rotated', {
        senderId: profile.id,
      });
      return key;
    },
    [broadcastConversationEvent, identity.ecdh.privateKey, profile.id],
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

  const hydrateRow = useCallback(
    async (
      row: StoredMessageRow,
      conversationList: Conversation[],
    ): Promise<ChatMessage | null> => {
      const { seenAt, expiresAt } = resolveSeenTimers(row.seen_at, row.expires_at);
      if (expiresAt !== null && expiresAt <= Date.now()) {
        const cached = decryptedRef.current.get(row.id);
        if (cached?.attachment?.url) URL.revokeObjectURL(cached.attachment.url);
        decryptedRef.current.delete(row.id);
        return null;
      }

      const seenBy = Array.isArray(row.seen_by) ? row.seen_by : [];
      const existing = decryptedRef.current.get(row.id);
      if (existing) {
        const updated: ChatMessage = {
          ...existing,
          seenAt,
          expiresAt,
          seenBy,
          status: seenAt !== null ? 'seen' : 'sent',
        };
        decryptedRef.current.set(row.id, updated);
        return updated;
      }

      const conversation = conversationList.find((item) => item.id === row.conversation_id);
      if (!conversation) return null;

      const member: ConversationMember | undefined = conversation.members.find(
        (item) => item.userId === row.sender_id,
      );
      if (!member?.publicKey) return null;

      let key = await loadKeyForReceive(row.conversation_id);
      if (!key) return null;

      let unpacked = await unpackStoredMessage(row, key, member.publicKey);
      if (!unpacked) {
        key = await loadKeyForReceive(row.conversation_id, true);
        if (!key) return null;
        unpacked = await unpackStoredMessage(row, key, member.publicKey);
      }
      if (!unpacked) return null;

      const createdAt = Number.isFinite(row.client_created_at)
        ? row.client_created_at
        : Date.parse(row.created_at) || Date.now();

      let message: ChatMessage;
      if (unpacked.kind === 'text') {
        message = {
          id: row.id,
          conversationId: row.conversation_id,
          senderId: row.sender_id,
          senderName: member.displayName,
          kind: 'text',
          text: unpacked.text,
          createdAt,
          seenAt,
          expiresAt,
          seenBy,
          mine: row.sender_id === profile.id,
          status: seenAt !== null ? 'seen' : 'sent',
        };
      } else {
        const blob = new Blob([unpacked.bytes], { type: unpacked.mime });
        const url = URL.createObjectURL(blob);
        message = {
          id: row.id,
          conversationId: row.conversation_id,
          senderId: row.sender_id,
          senderName: member.displayName,
          kind: 'file',
          text: unpacked.caption,
          attachment: {
            id: row.id,
            name: unpacked.name,
            mime: unpacked.mime,
            size: unpacked.size,
            url,
            progress: 100,
          },
          createdAt,
          seenAt,
          expiresAt,
          seenBy,
          mine: row.sender_id === profile.id,
          status: seenAt !== null ? 'seen' : 'sent',
        };
      }

      decryptedRef.current.set(row.id, message);
      return message;
    },
    [loadKeyForReceive, profile.id],
  );

  const syncAll = useCallback(
    async (silent = true): Promise<Conversation[]> => {
      if (!silent) {
        setConversationsLoading(true);
        setConversationsError(null);
      }
      try {
        const [nextConversations, rows] = await Promise.all([
          fetchConversations(),
          fetchStoredMessages(),
        ]);
        conversationsRef.current = nextConversations;
        setConversations(nextConversations);
        setConversationsError(null);

        const currentActive = activeIdRef.current;
        if (
          currentActive &&
          !nextConversations.some((conversation) => conversation.id === currentActive)
        ) {
          activeIdRef.current = null;
          setActiveIdState(null);
        }

        const hydrated = await Promise.all(rows.map((row) => hydrateRow(row, nextConversations)));
        const activeRowIds = new Set<string>();
        const grouped: Record<string, ChatMessage[]> = {};

        for (const msg of hydrated) {
          if (!msg) continue;
          activeRowIds.add(msg.id);
          const bucket = grouped[msg.conversationId] ?? [];
          bucket.push(msg);
          grouped[msg.conversationId] = bucket;
        }

        // Preserve any optimistic 'sending' messages not yet returned by the server
        for (const [convId, list] of Object.entries(messagesRef.current)) {
          for (const msg of list) {
            if (msg.status === 'sending' && !activeRowIds.has(msg.id)) {
              const bucket = grouped[convId] ?? [];
              bucket.push(msg);
              grouped[convId] = bucket;
              activeRowIds.add(msg.id);
            }
          }
        }

        // Revoke object URLs for messages that expired or were removed on the server
        for (const [id, cached] of decryptedRef.current) {
          if (!activeRowIds.has(id)) {
            if (cached.attachment?.url) URL.revokeObjectURL(cached.attachment.url);
            decryptedRef.current.delete(id);
          }
        }

        const nextMessages: Record<string, ChatMessage[]> = {};
        for (const [convId, bucket] of Object.entries(grouped)) {
          const sorted = sortMessages(bucket);
          nextMessages[convId] =
            sorted.length > MAX_MESSAGES_PER_CONVERSATION
              ? sorted.slice(sorted.length - MAX_MESSAGES_PER_CONVERSATION)
              : sorted;
        }

        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        return nextConversations;
      } catch (error) {
        const message = errorMessage(error, 'Unable to load conversations.');
        if (!silent) setConversationsError(message);
        throw error;
      } finally {
        if (!silent) setConversationsLoading(false);
      }
    },
    [hydrateRow],
  );

  const scheduleSync = useCallback(() => {
    if (syncInFlightRef.current) {
      syncQueuedRef.current = true;
      return;
    }
    const run = async () => {
      try {
        do {
          syncQueuedRef.current = false;
          try {
            await syncAll(true);
          } catch {
            // Keep current UI state on transient offline glitches.
          }
        } while (syncQueuedRef.current);
      } finally {
        syncInFlightRef.current = null;
      }
    };
    syncInFlightRef.current = run();
  }, [syncAll]);

  const refreshConversations = useCallback(
    async (silent = false): Promise<Conversation[]> => syncAll(silent),
    [syncAll],
  );

  const applySeenReceipts = useCallback(
    (conversationId: string, receipts: SeenMessageReceipt[]) => {
      if (!receipts.length) return;
      const byId = new Map(receipts.map((item) => [item.id, item]));
      updateMessages((current) => {
        const list = current[conversationId];
        if (!list) return current;
        let changed = false;
        const next = list.map((msg) => {
          const receipt = byId.get(msg.id);
          if (!receipt) return msg;
          const { seenAt, expiresAt } = resolveSeenTimers(receipt.seen_at, receipt.expires_at);
          const nextSeenBy = Array.isArray(receipt.seen_by)
            ? receipt.seen_by
            : msg.seenBy?.includes(profile.id)
              ? msg.seenBy
              : [...(msg.seenBy ?? []), profile.id];
          if (
            msg.seenAt === seenAt &&
            msg.expiresAt === expiresAt &&
            msg.seenBy?.length === nextSeenBy.length
          ) {
            return msg;
          }
          changed = true;
          const updated: ChatMessage = {
            ...msg,
            seenAt,
            expiresAt,
            seenBy: nextSeenBy,
            status: seenAt !== null ? 'seen' : msg.status,
          };
          decryptedRef.current.set(msg.id, updated);
          return updated;
        });
        return changed ? { ...current, [conversationId]: next } : current;
      });
    },
    [profile.id, updateMessages],
  );

  const notifyPeers = useCallback(
    async (
      userIds: Iterable<string>,
      event = 'conversation-updated',
      payload: Record<string, unknown> = {},
    ) => {
      const targets = [...new Set(userIds)].filter((id) => id && id !== profile.id);
      await Promise.allSettled(
        targets.map((userId) => sendUserEvent(userId, event, payload).catch(() => undefined)),
      );
    },
    [profile.id],
  );

  // Mark peer messages as SEEN (starting the 1-minute countdown) ONLY when the
  // user explicitly opens that individual conversation in a visible tab.
  const activeMessages = activeId ? (messages[activeId] ?? []) : [];
  const hasUnseenInActive = activeMessages.some(
    (msg) => !msg.mine && msg.seenAt === null && !(msg.seenBy ?? []).includes(profile.id),
  );

  const triggerMarkSeen = useCallback(
    async (conversationId: string) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (markingSeenRef.current.has(conversationId)) return;
      const list = messagesRef.current[conversationId] ?? [];
      if (
        !list.some(
          (msg) => !msg.mine && msg.seenAt === null && !(msg.seenBy ?? []).includes(profile.id),
        )
      ) {
        return;
      }

      markingSeenRef.current.add(conversationId);
      try {
        const receipts = await markConversationSeen(conversationId);
        if (receipts.length > 0) {
          applySeenReceipts(conversationId, receipts);
          const conv = findConversation(conversationId);
          void broadcastConversationEvent(conversationId, 'messages-seen', {
            conversationId,
            receipts,
          });
          if (conv) {
            void notifyPeers(
              conv.members.map((m) => m.userId),
              'messages-seen',
              { conversationId, receipts },
            );
          }
        }
      } catch {
        // Retry automatically on next sync/visibility event.
      } finally {
        markingSeenRef.current.delete(conversationId);
      }
    },
    [applySeenReceipts, broadcastConversationEvent, findConversation, notifyPeers, profile.id],
  );

  useEffect(() => {
    if (!activeId || !hasUnseenInActive) return;
    void triggerMarkSeen(activeId);
  }, [activeId, hasUnseenInActive, triggerMarkSeen]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && activeIdRef.current) {
        void triggerMarkSeen(activeIdRef.current);
        scheduleSync();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [scheduleSync, triggerMarkSeen]);

  const sendText = useCallback(
    async (rawText: string) => {
      const conversationId = activeIdRef.current;
      if (!conversationId) throw new Error('Choose a conversation first.');
      let conversation = findConversation(conversationId);
      if (!conversation) throw new Error('This conversation is no longer available.');

      const text = messageTextSchema.parse(rawText);

      // If recipient replies directly inside an incoming request, accept it automatically.
      if (isIncomingRequest(conversation, profile.id)) {
        await acceptMessageRequest(conversation.id);
        const refreshed = await syncAll(true);
        conversation = refreshed.find((c) => c.id === conversationId) ?? conversation;
      }

      const key = await ensureKeyForSend(conversation);
      const id = randomId();
      const createdAt = Date.now();

      const optimistic: ChatMessage = {
        id,
        conversationId: conversation.id,
        senderId: profile.id,
        senderName: profile.display_name,
        kind: 'text',
        text,
        createdAt,
        seenAt: null,
        expiresAt: null,
        status: 'sending',
        mine: true,
      };

      updateMessages((current) => ({
        ...current,
        [conversation!.id]: sortMessages([...(current[conversation!.id] ?? []), optimistic]),
      }));

      try {
        const packed = await packStoredTextMessage({
          key,
          id,
          conversationId: conversation.id,
          senderId: profile.id,
          text,
          createdAt,
          signPrivateKey: identity.sig.privateKey,
        });
        const savedRow = await sendEncryptedMessage(packed);
        const { seenAt, expiresAt } = resolveSeenTimers(savedRow.seen_at, savedRow.expires_at);
        const confirmed: ChatMessage = {
          ...optimistic,
          seenAt,
          expiresAt,
          status: seenAt !== null ? 'seen' : 'sent',
        };
        decryptedRef.current.set(id, confirmed);
        updateMessages((current) => ({
          ...current,
          [conversation!.id]: (current[conversation!.id] ?? []).map((item) =>
            item.id === id ? confirmed : item,
          ),
        }));

        void broadcastConversationEvent(conversation.id, 'message-stored', {
          conversationId: conversation.id,
          messageId: id,
        });
        void notifyPeers(conversation.members.map((m) => m.userId));
      } catch (error) {
        updateMessages((current) => ({
          ...current,
          [conversation!.id]: (current[conversation!.id] ?? []).filter((item) => item.id !== id),
        }));
        throw error;
      }
    },
    [
      broadcastConversationEvent,
      ensureKeyForSend,
      findConversation,
      identity.sig.privateKey,
      notifyPeers,
      profile.display_name,
      profile.id,
      syncAll,
      updateMessages,
    ],
  );

  const sendFile = useCallback(
    async (rawFile: File, rawCaption?: string) => {
      const conversationId = activeIdRef.current;
      if (!conversationId) throw new Error('Choose a conversation first.');
      const conversation = findConversation(conversationId);
      if (!conversation) throw new Error('This conversation is no longer available.');

      if (conversation.requestStatus === 'pending') {
        throw new Error('Attachments unlock once this message request is accepted.');
      }

      const prepared = await prepareAttachmentFile(rawFile);
      if (!prepared.ok) throw new Error(prepared.error);

      const caption = rawCaption?.trim() ? messageTextSchema.parse(rawCaption) : undefined;
      const key = await ensureKeyForSend(conversation);
      const id = randomId();
      const createdAt = Date.now();
      const bytes = new Uint8Array(await prepared.file.arrayBuffer());
      const localUrl = URL.createObjectURL(new Blob([bytes], { type: prepared.mime }));

      const optimistic: ChatMessage = {
        id,
        conversationId: conversation.id,
        senderId: profile.id,
        senderName: profile.display_name,
        kind: 'file',
        text: caption,
        attachment: {
          id,
          name: prepared.name,
          mime: prepared.mime,
          size: bytes.byteLength,
          url: localUrl,
          progress: 50,
        },
        createdAt,
        seenAt: null,
        expiresAt: null,
        status: 'sending',
        mine: true,
      };

      updateMessages((current) => ({
        ...current,
        [conversation.id]: sortMessages([...(current[conversation.id] ?? []), optimistic]),
      }));

      try {
        const packed = await packStoredFileMessage({
          key,
          id,
          conversationId: conversation.id,
          senderId: profile.id,
          name: prepared.name,
          mime: prepared.mime,
          bytes,
          caption,
          createdAt,
          signPrivateKey: identity.sig.privateKey,
        });
        const savedRow = await sendEncryptedMessage(packed);
        const { seenAt, expiresAt } = resolveSeenTimers(savedRow.seen_at, savedRow.expires_at);
        const confirmed: ChatMessage = {
          ...optimistic,
          attachment: {
            ...optimistic.attachment!,
            progress: 100,
          },
          seenAt,
          expiresAt,
          status: seenAt !== null ? 'seen' : 'sent',
        };
        decryptedRef.current.set(id, confirmed);
        updateMessages((current) => ({
          ...current,
          [conversation.id]: (current[conversation.id] ?? []).map((item) =>
            item.id === id ? confirmed : item,
          ),
        }));

        if (prepared.compressed) {
          toast('Photo optimized automatically to save cloud space.', 'info');
        }

        void broadcastConversationEvent(conversation.id, 'message-stored', {
          conversationId: conversation.id,
          messageId: id,
        });
        void notifyPeers(conversation.members.map((m) => m.userId));
      } catch (error) {
        URL.revokeObjectURL(localUrl);
        updateMessages((current) => ({
          ...current,
          [conversation.id]: (current[conversation.id] ?? []).filter((item) => item.id !== id),
        }));
        throw error;
      }
    },
    [
      broadcastConversationEvent,
      ensureKeyForSend,
      findConversation,
      identity.sig.privateKey,
      notifyPeers,
      profile.display_name,
      profile.id,
      toast,
      updateMessages,
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

  const startDirectMessage = useCallback(
    async (person: PeopleResult): Promise<string> => {
      const id = await startDm(person.username);
      const next = await syncAll(true);
      const conversation = next.find((item) => item.id === id);
      if (conversation) {
        const existingKey = await unwrapKeyRow(id).catch(() => null);
        if (!existingKey) {
          await rotateConversationKey(conversation);
        }
      }
      setActiveId(id);
      void notifyPeers([person.id]);
      return id;
    },
    [notifyPeers, rotateConversationKey, setActiveId, syncAll, unwrapKeyRow],
  );

  const acceptRequest = useCallback(
    async (conversationId: string): Promise<void> => {
      const existing = findConversation(conversationId);
      await acceptMessageRequest(conversationId);
      await syncAll(true);
      setActiveId(conversationId);
      if (existing) {
        void notifyPeers(existing.members.map((member) => member.userId));
      }
      toast('Message request accepted.', 'success');
    },
    [findConversation, notifyPeers, setActiveId, syncAll, toast],
  );

  const declineRequest = useCallback(
    async (conversationId: string): Promise<void> => {
      const existing = findConversation(conversationId);
      await declineMessageRequest(conversationId);
      keysRef.current.delete(conversationId);
      const list = messagesRef.current[conversationId] ?? [];
      for (const msg of list) {
        if (msg.attachment?.url) URL.revokeObjectURL(msg.attachment.url);
        decryptedRef.current.delete(msg.id);
      }
      if (activeIdRef.current === conversationId) setActiveId(null);
      await syncAll(true);
      if (existing) {
        void notifyPeers(existing.members.map((member) => member.userId));
      }
      toast('Message request removed.', 'info');
    },
    [findConversation, notifyPeers, setActiveId, syncAll, toast],
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
      const next = await syncAll(true);
      const conversation = next.find((item) => item.id === id);
      if (conversation) {
        await rotateConversationKey(conversation);
      }
      setActiveId(id);
      await notifyPeers(people.map((person) => person.id));
      return id;
    },
    [notifyPeers, rotateConversationKey, setActiveId, syncAll],
  );

  const addGroupMember = useCallback(
    async (conversationId: string, username: string): Promise<void> => {
      const userId = await addGroupMemberRequest(conversationId, username);
      const next = await syncAll(true);
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
    [notifyPeers, rotateConversationKey, syncAll, toast],
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
      await syncAll(true);
      await notifyPeers([userId, ...remaining.map((member) => member.userId)]);
    },
    [findConversation, notifyPeers, rotateConversationKey, syncAll, toast],
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
      await syncAll(true);
      await notifyPeers(remaining.map((member) => member.userId));
    },
    [findConversation, notifyPeers, profile.id, rotateConversationKey, setActiveId, syncAll],
  );

  const renameGroupChat = useCallback(
    async (conversationId: string, title: string): Promise<void> => {
      const existing = findConversation(conversationId);
      await renameGroupRequest(conversationId, title.trim());
      await syncAll(true);
      if (existing) {
        await notifyPeers(existing.members.map((member) => member.userId));
      }
    },
    [findConversation, notifyPeers, syncAll],
  );

  useEffect(() => {
    void syncAll(false).catch(() => undefined);
  }, [syncAll]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      scheduleSync();
    }, 15_000);
    const onFocus = () => {
      scheduleSync();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [scheduleSync]);

  useEffect(() => {
    let channel = requireSupabase().channel(`user:${profile.id}`, {
      config: { private: true, broadcast: { self: false, ack: true } },
    });
    userChannelRef.current = channel;

    for (const event of USER_EVENTS) {
      channel = channel.on('broadcast', { event }, ({ payload }) => {
        if (event === 'conversation-updated') {
          scheduleSync();
        } else if (event === 'messages-seen' && payload && typeof payload === 'object') {
          const data = payload as { conversationId?: string; receipts?: SeenMessageReceipt[] };
          if (data.conversationId && Array.isArray(data.receipts)) {
            applySeenReceipts(data.conversationId, data.receipts);
          }
        }
        for (const listener of userListenersRef.current) {
          listener(event, payload);
        }
      });
    }

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setConnection(navigator.onLine ? 'connected' : 'offline');
        scheduleSync();
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setConnection(navigator.onLine ? 'connecting' : 'offline');
      }
    });

    return () => {
      userChannelRef.current = null;
      void requireSupabase().removeChannel(channel);
    };
  }, [applySeenReceipts, profile.id, scheduleSync]);

  useEffect(() => {
    const onOnline = () => {
      setConnection(userChannelRef.current?.state === 'joined' ? 'connected' : 'connecting');
      scheduleSync();
    };
    const onOffline = () => setConnection('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [scheduleSync]);

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
      for (const event of CONVERSATION_EVENTS) {
        channel = channel.on('broadcast', { event }, ({ payload }) => {
          if (event === 'message-stored') {
            scheduleSync();
          } else if (event === 'messages-seen' && payload && typeof payload === 'object') {
            const data = payload as { conversationId?: string; receipts?: SeenMessageReceipt[] };
            if (Array.isArray(data.receipts)) {
              applySeenReceipts(conversationId, data.receipts);
            }
          } else if (event === 'key-rotated') {
            keysRef.current.delete(conversationId);
            scheduleSync();
          }
        });
      }
      channel.subscribe();
      channelsRef.current.set(conversationId, channel);
    }

    for (const [conversationId, channel] of channelsRef.current) {
      if (ids.has(conversationId)) continue;
      channelsRef.current.delete(conversationId);
      keysRef.current.delete(conversationId);
      void requireSupabase().removeChannel(channel);
    }
  }, [applySeenReceipts, conversationIds, scheduleSync]);

  useEffect(() => {
    const channels = channelsRef.current;
    const keys = keysRef.current;
    const decrypted = decryptedRef.current;
    return () => {
      for (const channel of channels.values()) {
        void requireSupabase().removeChannel(channel);
      }
      channels.clear();
      void closeOutboundChannels();
      for (const message of decrypted.values()) {
        if (message.attachment?.url) URL.revokeObjectURL(message.attachment.url);
      }
      decrypted.clear();
      keys.clear();
    };
  }, []);

  // Automatic 1-second sweep for messages whose 1-minute post-seen timer reached 0:00.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const revoked: string[] = [];
      let expiredAny = false;

      updateMessages((current) => {
        let changed = false;
        const next: Record<string, ChatMessage[]> = {};
        for (const [conversationId, list] of Object.entries(current)) {
          const kept = list.filter((message) => {
            if (message.expiresAt === null || message.expiresAt > now) return true;
            changed = true;
            expiredAny = true;
            if (message.attachment?.url) revoked.push(message.attachment.url);
            decryptedRef.current.delete(message.id);
            return false;
          });
          next[conversationId] = kept;
        }
        return changed ? next : current;
      });

      for (const url of revoked) URL.revokeObjectURL(url);

      if (expiredAny) {
        const elapsed = now - lastServerPurgeRef.current;
        if (elapsed >= 1_500) {
          lastServerPurgeRef.current = now;
          void purgeExpiredMessages();
        } else if (purgeTimeoutRef.current === null) {
          purgeTimeoutRef.current = window.setTimeout(() => {
            purgeTimeoutRef.current = null;
            lastServerPurgeRef.current = Date.now();
            void purgeExpiredMessages();
          }, 1_500 - elapsed);
        }
      }
    }, 1_000);
    return () => {
      window.clearInterval(timer);
      if (purgeTimeoutRef.current !== null) {
        window.clearTimeout(purgeTimeoutRef.current);
        purgeTimeoutRef.current = null;
      }
    };
  }, [updateMessages]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );

  const { activeChats, incomingRequests } = useMemo(() => {
    const chats: Conversation[] = [];
    const requests: Conversation[] = [];
    for (const conv of conversations) {
      if (isIncomingRequest(conv, profile.id)) {
        requests.push(conv);
      } else {
        chats.push(conv);
      }
    }
    return { activeChats: chats, incomingRequests: requests };
  }, [conversations, profile.id]);

  const unread = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [convId, list] of Object.entries(messages)) {
      const unseenCount = list.filter(
        (msg) => !msg.mine && msg.seenAt === null && !(msg.seenBy ?? []).includes(profile.id),
      ).length;
      if (unseenCount > 0) counts[convId] = unseenCount;
    }
    return counts;
  }, [messages, profile.id]);

  const totalUnreadChats = useMemo(
    () => activeChats.reduce((sum, conv) => sum + (unread[conv.id] ?? 0), 0),
    [activeChats, unread],
  );

  const incomingRequestCount = incomingRequests.length;

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations,
      activeChats,
      incomingRequests,
      conversationsLoading,
      conversationsError,
      activeId,
      activeConversation,
      messages,
      unread,
      totalUnreadChats,
      incomingRequestCount,
      connection,
      setActiveId,
      refreshConversations,
      startDirectMessage,
      acceptRequest,
      declineRequest,
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
      activeChats,
      incomingRequests,
      conversationsLoading,
      conversationsError,
      activeId,
      activeConversation,
      messages,
      unread,
      totalUnreadChats,
      incomingRequestCount,
      connection,
      setActiveId,
      refreshConversations,
      startDirectMessage,
      acceptRequest,
      declineRequest,
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
