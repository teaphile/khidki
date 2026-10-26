export type Jwk = {
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  d?: string;
  [key: string]: unknown;
};

export type PrivateKeyMaterial = CryptoKey | Jwk;

export type PublicKeyBundle = {
  v: 1;
  ecdh: Jwk;
  sig: Jwk;
};

export type Identity = {
  v: 1 | 2;
  ecdh: { publicKey: Jwk; privateKey: PrivateKeyMaterial };
  sig: { publicKey: Jwk; privateKey: PrivateKeyMaterial };
};

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  public_key: PublicKeyBundle | null;
  created_at: string;
};

export type ConversationRole = 'admin' | 'member';

export type ConversationMember = {
  userId: string;
  role: ConversationRole;
  username: string;
  displayName: string;
  publicKey: PublicKeyBundle | null;
};

export type Conversation = {
  id: string;
  kind: 'dm' | 'group';
  title: string;
  createdBy: string | null;
  createdAt: string;
  members: ConversationMember[];
};

export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  url?: string;
  progress?: number;
  width?: number;
  height?: number;
};

export type MessageStatus = 'sending' | 'sent' | 'receiving';

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  kind: 'text' | 'file';
  text?: string;
  attachment?: Attachment;
  createdAt: number;
  expiresAt: number;
  status: MessageStatus;
  mine: boolean;
};

export type PeopleResult = {
  id: string;
  username: string;
  display_name: string;
  public_key: PublicKeyBundle;
};

export type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

export type CallState = {
  status: CallStatus;
  callId: string | null;
  conversationId: string | null;
  peerId: string | null;
  peerName: string;
  video: boolean;
  startedAt: number | null;
  error: string | null;
};

export type AppView = 'chats' | 'people';
export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
