export type Jwk = JsonWebKey;
export type PrivateKeyMaterial = CryptoKey | Jwk;

export type PublicKeyBundle = {
  v: 1;
  ecdh: Jwk;
  sig: Jwk;
};

export type KeyVault = {
  v: 1;
  salt: string;
  iv: string;
  ct: string;
  iter: number;
};

export type Identity = {
  v: 1 | 2;
  createdAt?: number;
  ecdh: {
    publicKey: Jwk;
    privateKey: PrivateKeyMaterial;
  };
  sig: {
    publicKey: Jwk;
    privateKey: PrivateKeyMaterial;
  };
};

export const AVATAR_IDS = [
  'initials',
  'fox',
  'owl',
  'cat',
  'wolf',
  'panda',
  'crown',
  'bolt',
  'flame',
  'moon',
  'star',
  'lotus',
  'gem',
  'wave',
  'shield',
  'music',
  'rocket',
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_id: AvatarId;
  public_key: PublicKeyBundle | null;
  key_vault: KeyVault | null;
  created_at: string;
};

export type PeopleResult = {
  id: string;
  username: string;
  display_name: string;
  avatar_id: AvatarId;
  public_key: PublicKeyBundle | null;
};

export type ConversationKind = 'dm' | 'group';
export type MemberRole = 'admin' | 'member';
export type RequestStatus = 'pending' | 'accepted';

export type ConversationMember = {
  userId: string;
  username: string;
  displayName: string;
  avatarId: AvatarId;
  publicKey: PublicKeyBundle | null;
  role: MemberRole;
};

export type Conversation = {
  id: string;
  kind: ConversationKind;
  title: string;
  createdBy: string | null;
  createdAt: string;
  lastMessageAt: string;
  requestStatus: RequestStatus;
  requestedBy: string | null;
  members: ConversationMember[];
};

export type AttachmentPayload = {
  id?: string;
  name: string;
  mime: string;
  size: number;
  url?: string;
  progress?: number;
};

export type MessageStatus = 'sending' | 'receiving' | 'sent' | 'seen' | 'failed';

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  kind: 'text' | 'file';
  text?: string;
  attachment?: AttachmentPayload;
  createdAt: number;
  seenAt: number | null;
  expiresAt: number | null;
  mine: boolean;
  status: MessageStatus;
};

export type StoredMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: 'text' | 'file';
  iv: string;
  ciphertext: string;
  sig: string;
  byte_size: number;
  client_created_at: number;
  created_at: string;
  seen_at: string | null;
  expires_at: string | null;
};

export type CallSignalRow = {
  id: string;
  call_id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  event: string;
  envelope: Record<string, unknown>;
  created_at: string;
};

export type AppView = 'chats' | 'requests' | 'people';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active';

export type CallState = {
  status: CallStatus;
  callId: string | null;
  conversationId: string | null;
  peerId: string | null;
  peerName: string;
  peerAvatarId: AvatarId;
  video: boolean;
  startedAt: number | null;
  error: string | null;
};
