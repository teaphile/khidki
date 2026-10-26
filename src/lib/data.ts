import type {
  CallSignalRow,
  Conversation,
  ConversationMember,
  KeyVault,
  PeopleResult,
  Profile,
  PublicKeyBundle,
  RequestStatus,
  StoredMessageRow,
} from '../types';
import { parseKeyVault, parsePublicKeyBundle } from './crypto';
import { parseDpUrl } from './dp';
import { requireSupabase } from './env';

type RawVault = {
  key_vault: unknown;
};

type RawProfile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: unknown;
  public_key: unknown;
  profile_vaults?: RawVault | RawVault[] | null;
  created_at: string;
};

type RawMember = {
  user_id: string;
  role: 'admin' | 'member';
  profiles: RawProfile | RawProfile[] | null;
};

type RawConversation = {
  id: string;
  kind: 'dm' | 'group';
  title: string | null;
  created_by: string | null;
  created_at: string;
  last_message_at?: string | null;
  request_status?: string | null;
  requested_by?: string | null;
  conversation_members: RawMember[];
};

function fail(error: { message: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback);
}

function profileOf(member: RawMember): RawProfile | null {
  return Array.isArray(member.profiles) ? (member.profiles[0] ?? null) : member.profiles;
}

function extractVault(raw: RawProfile): unknown {
  if (!raw.profile_vaults) return null;
  if (Array.isArray(raw.profile_vaults)) return raw.profile_vaults[0]?.key_vault ?? null;
  return raw.profile_vaults.key_vault ?? null;
}

function normalizeProfile(raw: RawProfile): Profile {
  return {
    id: raw.id,
    username: raw.username,
    display_name: raw.display_name,
    avatar_url: parseDpUrl(raw.avatar_url),
    public_key: parsePublicKeyBundle(raw.public_key),
    key_vault: parseKeyVault(extractVault(raw)),
    created_at: raw.created_at,
  };
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select(
      'id, username, display_name, avatar_url, public_key, created_at, profile_vaults ( key_vault )',
    )
    .eq('id', userId)
    .maybeSingle<RawProfile>();
  fail(error, 'Unable to load your profile.');
  return data ? normalizeProfile(data) : null;
}

export async function updateProfile(
  userId: string,
  patch: {
    display_name?: string;
    avatar_url?: string | null;
    public_key?: PublicKeyBundle | null;
    key_vault?: KeyVault | null;
  },
): Promise<Profile> {
  const { key_vault, ...profilePatch } = patch;
  const client = requireSupabase();

  if (Object.keys(profilePatch).length > 0) {
    const { error } = await client.from('profiles').update(profilePatch).eq('id', userId);
    fail(error, 'Unable to update your profile.');
  }

  if (key_vault) {
    const { error: vaultError } = await client
      .from('profile_vaults')
      .upsert({ user_id: userId, key_vault }, { onConflict: 'user_id' });
    fail(vaultError, 'Unable to update your key vault.');
  }

  const updated = await fetchProfile(userId);
  if (!updated) throw new Error('Your profile could not be loaded after update.');
  return updated;
}

export async function fetchConversations(): Promise<Conversation[]> {
  const { data, error } = await requireSupabase()
    .from('conversations')
    .select(
      `id, kind, title, created_by, created_at, last_message_at, request_status, requested_by,
       conversation_members!inner (
         user_id, role,
         profiles ( id, username, display_name, avatar_url, public_key, created_at )
       )`,
    )
    .order('last_message_at', { ascending: false });
  fail(error, 'Unable to load conversations.');

  return ((data ?? []) as unknown as RawConversation[]).map((row) => {
    const members: ConversationMember[] = row.conversation_members
      .map((member) => {
        const profile = profileOf(member);
        if (!profile) return null;
        return {
          userId: profile.id,
          role: member.role,
          username: profile.username,
          displayName: profile.display_name,
          avatarUrl: parseDpUrl(profile.avatar_url),
          publicKey: parsePublicKeyBundle(profile.public_key),
        } satisfies ConversationMember;
      })
      .filter((member): member is ConversationMember => member !== null);

    const requestStatus: RequestStatus = row.request_status === 'pending' ? 'pending' : 'accepted';

    return {
      id: row.id,
      kind: row.kind,
      title: row.title ?? '',
      createdBy: row.created_by,
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at ?? row.created_at,
      requestStatus,
      requestedBy: row.requested_by ?? null,
      members,
    } satisfies Conversation;
  });
}

export type WrappedKeyRow = {
  conversation_id: string;
  user_id: string;
  wrapped_key: string;
  wrap_iv: string;
  from_user: string;
  from_public_key: PublicKeyBundle;
  updated_at: string;
};

type RawWrappedKeyRow = Omit<WrappedKeyRow, 'from_public_key'> & {
  from_public_key: unknown;
};

export async function fetchWrappedKey(conversationId: string): Promise<WrappedKeyRow | null> {
  const { data, error } = await requireSupabase()
    .from('conversation_keys')
    .select(
      'conversation_id, user_id, wrapped_key, wrap_iv, from_user, from_public_key, updated_at',
    )
    .eq('conversation_id', conversationId)
    .maybeSingle<RawWrappedKeyRow>();
  fail(error, 'Unable to load the conversation key.');
  if (!data) return null;
  const senderKey = parsePublicKeyBundle(data.from_public_key);
  if (!senderKey) return null;
  return { ...data, from_public_key: senderKey };
}

export async function fetchStoredMessages(conversationId?: string): Promise<StoredMessageRow[]> {
  let query = requireSupabase()
    .from('messages')
    .select(
      'id, conversation_id, sender_id, kind, iv, ciphertext, sig, byte_size, client_created_at, created_at, seen_at, expires_at, seen_by',
    )
    .order('client_created_at', { ascending: true })
    .limit(400);

  if (conversationId) {
    query = query.eq('conversation_id', conversationId);
  }

  const { data, error } = await query;
  fail(error, 'Unable to load encrypted messages.');
  return (data ?? []) as StoredMessageRow[];
}

export async function sendEncryptedMessage(input: {
  id: string;
  conversationId: string;
  kind: 'text' | 'file';
  iv: string;
  ciphertext: string;
  sig: string;
  byteSize: number;
  clientCreatedAt: number;
}): Promise<StoredMessageRow> {
  const { data, error } = await requireSupabase().rpc('send_encrypted_message', {
    p_id: input.id,
    p_conversation_id: input.conversationId,
    p_kind: input.kind,
    p_iv: input.iv,
    p_ciphertext: input.ciphertext,
    p_sig: input.sig,
    p_byte_size: input.byteSize,
    p_client_created_at: input.clientCreatedAt,
  });
  fail(error, 'Unable to send the message.');
  return data as StoredMessageRow;
}

export type SeenMessageReceipt = {
  id: string;
  seen_at: string | null;
  expires_at: string | null;
  seen_by?: string[];
};

export async function markConversationSeen(conversationId: string): Promise<SeenMessageReceipt[]> {
  const { data, error } = await requireSupabase().rpc('mark_conversation_seen', {
    p_conversation_id: conversationId,
  });
  fail(error, 'Unable to update seen status.');
  return (data ?? []) as SeenMessageReceipt[];
}

export async function purgeExpiredMessages(): Promise<number> {
  const { data, error } = await requireSupabase().rpc('purge_expired_messages');
  if (error) return 0;
  return Number(data ?? 0);
}

export async function acceptMessageRequest(conversationId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('accept_message_request', {
    p_conversation_id: conversationId,
  });
  fail(error, 'Unable to accept the message request.');
}

export async function declineMessageRequest(conversationId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('decline_message_request', {
    p_conversation_id: conversationId,
  });
  fail(error, 'Unable to decline the message request.');
}

export async function storeCallSignal(input: {
  callId: string;
  conversationId: string;
  recipientId: string;
  event: string;
  envelope: Record<string, unknown>;
}): Promise<void> {
  const { error } = await requireSupabase().rpc('store_call_signal', {
    p_call_id: input.callId,
    p_conversation_id: input.conversationId,
    p_recipient_id: input.recipientId,
    p_event: input.event,
    p_envelope: input.envelope,
  });
  if (error) {
    throw new Error(error.message || 'Unable to deliver call signal.');
  }
}

export async function pollCallSignals(sinceIso?: string | null): Promise<CallSignalRow[]> {
  const { data, error } = await requireSupabase().rpc('poll_call_signals', {
    p_since: sinceIso ?? null,
  });
  if (error) return [];
  return (data ?? []) as CallSignalRow[];
}

export async function clearCallSignals(callId: string): Promise<void> {
  await requireSupabase()
    .rpc('clear_call_signals', { p_call_id: callId })
    .then(() => undefined);
}

export async function searchPeople(query: string): Promise<PeopleResult[]> {
  const { data, error } = await requireSupabase().rpc('search_people', { p_query: query });
  fail(error, 'Unable to search for people.');
  return (
    (data ?? []) as Array<{
      id: string;
      username: string;
      display_name: string;
      avatar_url?: unknown;
      public_key: unknown;
    }>
  )
    .map((row) => {
      const publicKey = parsePublicKeyBundle(row.public_key);
      if (!publicKey) return null;
      return {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        avatar_url: parseDpUrl(row.avatar_url),
        public_key: publicKey,
      } as PeopleResult;
    })
    .filter((person): person is PeopleResult => person !== null);
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc('is_username_available', {
    p_username: username,
  });
  fail(error, 'Unable to check that username.');
  return Boolean(data);
}

export async function startDm(username: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc('start_dm', { p_username: username });
  fail(error, 'Unable to start the conversation.');
  return data as string;
}

export async function createGroup(title: string, usernames: string[]): Promise<string> {
  const { data, error } = await requireSupabase().rpc('create_group', {
    p_title: title,
    p_usernames: usernames,
  });
  fail(error, 'Unable to create the group.');
  return data as string;
}

export async function addGroupMember(conversationId: string, username: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc('add_group_member', {
    p_conversation_id: conversationId,
    p_username: username,
  });
  fail(error, 'Unable to add that person.');
  return data as string;
}

export async function removeGroupMember(conversationId: string, userId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('remove_group_member', {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });
  fail(error, 'Unable to remove that person.');
}

export async function leaveGroup(conversationId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('leave_group', {
    p_conversation_id: conversationId,
  });
  fail(error, 'Unable to leave the group.');
}

export async function renameGroup(conversationId: string, title: string): Promise<void> {
  const { error } = await requireSupabase().rpc('rename_group', {
    p_conversation_id: conversationId,
    p_title: title,
  });
  fail(error, 'Unable to rename the group.');
}

export type GroupKeyInput = { user_id: string; wrapped_key: string; wrap_iv: string };

export async function setConversationKeys(
  conversationId: string,
  keys: GroupKeyInput[],
): Promise<void> {
  const { error } = await requireSupabase().rpc('set_conversation_keys', {
    p_conversation_id: conversationId,
    p_keys: keys,
  });
  fail(error, 'Unable to share the conversation key.');
}

export async function deleteAccount(): Promise<void> {
  const { error } = await requireSupabase().rpc('delete_account');
  fail(error, 'Unable to delete your account.');
}
