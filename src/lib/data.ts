import type {
  Conversation,
  ConversationMember,
  PeopleResult,
  Profile,
  PublicKeyBundle,
} from '../types';
import { parsePublicKeyBundle } from './crypto';
import { requireSupabase } from './env';

type RawProfile = {
  id: string;
  username: string;
  display_name: string;
  public_key: unknown;
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
  conversation_members: RawMember[];
};

function fail(error: { message: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback);
}

function profileOf(member: RawMember): RawProfile | null {
  return Array.isArray(member.profiles) ? (member.profiles[0] ?? null) : member.profiles;
}

function normalizeProfile(raw: RawProfile): Profile {
  return {
    id: raw.id,
    username: raw.username,
    display_name: raw.display_name,
    public_key: parsePublicKeyBundle(raw.public_key),
    created_at: raw.created_at,
  };
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('id, username, display_name, public_key, created_at')
    .eq('id', userId)
    .maybeSingle<RawProfile>();
  fail(error, 'Unable to load your profile.');
  return data ? normalizeProfile(data) : null;
}

export async function updateProfile(
  userId: string,
  patch: { display_name?: string; public_key?: PublicKeyBundle | null },
): Promise<Profile> {
  const { data, error } = await requireSupabase()
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('id, username, display_name, public_key, created_at')
    .single<RawProfile>();
  fail(error, 'Unable to update your profile.');
  if (!data) throw new Error('Your profile could not be updated.');
  return normalizeProfile(data);
}

export async function fetchConversations(): Promise<Conversation[]> {
  const { data, error } = await requireSupabase()
    .from('conversations')
    .select(
      `id, kind, title, created_by, created_at,
       conversation_members!inner (
         user_id, role,
         profiles ( id, username, display_name, public_key, created_at )
       )`,
    )
    .order('created_at', { ascending: false });
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
          publicKey: parsePublicKeyBundle(profile.public_key),
        } satisfies ConversationMember;
      })
      .filter((member): member is ConversationMember => member !== null);

    return {
      id: row.id,
      kind: row.kind,
      title: row.title ?? '',
      createdBy: row.created_by,
      createdAt: row.created_at,
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

export async function searchPeople(query: string): Promise<PeopleResult[]> {
  const { data, error } = await requireSupabase().rpc('search_people', { p_query: query });
  fail(error, 'Unable to search for people.');
  return (
    (data ?? []) as Array<{
      id: string;
      username: string;
      display_name: string;
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
        public_key: publicKey,
      } satisfies PeopleResult;
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
