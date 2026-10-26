import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Crown,
  Loader2,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserMinus,
  Video,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';
import { useChat } from '../../context/ChatContext';
import { useToast } from '../../context/ToastContext';
import { searchPeople } from '../../lib/data';
import { publicBundle, safetyNumberForPair } from '../../lib/crypto';
import {
  conversationDpUrl,
  conversationHandle,
  conversationSeed,
  conversationTitle,
  dmPeer,
} from '../../lib/format';
import { sanitizeUsernameInput } from '../../lib/validation';
import type { Conversation, PeopleResult } from '../../types';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';

export function ConversationInfoDialog({
  conversation,
  open,
  onClose,
}: {
  conversation: Conversation;
  open: boolean;
  onClose: () => void;
}) {
  const { profile, identity } = useAuth();
  const { addGroupMember, removeGroupMember, leaveGroupChat, renameGroupChat } = useChat();
  const { startCall } = useCall();
  const { toast } = useToast();
  const myId = profile?.id ?? '';
  const me = conversation.members.find((member) => member.userId === myId);
  const isAdmin = me?.role === 'admin';
  const title = conversationTitle(conversation, myId);
  const peer = dmPeer(conversation, myId);
  const isPending = conversation.kind === 'dm' && conversation.requestStatus === 'pending';

  const [renameValue, setRenameValue] = useState(conversation.title);
  const [renaming, setRenaming] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PeopleResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    setRenameValue(conversation.title);
    setQuery('');
    setResults([]);
    setConfirmRemove(null);
    setConfirmLeave(false);
  }, [conversation.id, conversation.title, open]);

  useEffect(() => {
    if (!open || conversation.kind !== 'dm' || !peer?.publicKey || !identity) {
      setSafetyNumber(null);
      return;
    }
    let active = true;
    void safetyNumberForPair(publicBundle(identity), peer.publicKey).then((value) => {
      if (active) setSafetyNumber(value);
    });
    return () => {
      active = false;
    };
  }, [conversation.kind, identity, peer, open]);

  useEffect(() => {
    if (!open || conversation.kind !== 'group' || !isAdmin) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const id = ++requestId.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchPeople(trimmed)
        .then((people) => {
          if (requestId.current !== id) return;
          setResults(
            people.filter(
              (person) => !conversation.members.some((member) => member.userId === person.id),
            ),
          );
        })
        .catch(() => {
          if (requestId.current === id) setResults([]);
        })
        .finally(() => {
          if (requestId.current === id) setSearching(false);
        });
    }, 240);
    return () => window.clearTimeout(timer);
  }, [conversation.kind, conversation.members, isAdmin, open, query]);

  const add = async (person: PeopleResult) => {
    setAdding(person.id);
    try {
      await addGroupMember(conversation.id, person.username);
      setQuery('');
      setResults([]);
      toast(`${person.display_name} was added and the group key rotated.`, 'success');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Unable to add that person.', 'error');
    } finally {
      setAdding(null);
    }
  };

  const remove = async (userId: string, name: string) => {
    if (confirmRemove !== userId) {
      setConfirmRemove(userId);
      return;
    }
    try {
      await removeGroupMember(conversation.id, userId);
      setConfirmRemove(null);
      toast(`${name} was removed and a fresh group key shared.`, 'success');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Unable to remove that person.', 'error');
    }
  };

  const saveName = async () => {
    setRenaming(true);
    try {
      await renameGroupChat(conversation.id, renameValue);
      toast('Group name updated.', 'success');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Unable to rename the group.', 'error');
    } finally {
      setRenaming(false);
    }
  };

  const leave = async () => {
    if (!confirmLeave) {
      setConfirmLeave(true);
      return;
    }
    setLeaving(true);
    try {
      await leaveGroupChat(conversation.id);
      toast('You left the group.', 'info');
      onClose();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Unable to leave the group.', 'error');
    } finally {
      setLeaving(false);
    }
  };

  const call = async (video: boolean) => {
    try {
      await startCall(conversation, video);
      onClose();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Unable to start the call.', 'error');
    }
  };

  const copyFingerprint = async () => {
    if (!safetyNumber) return;
    try {
      await navigator.clipboard.writeText(safetyNumber.replace(/\s/g, ''));
      toast('Safety number copied.', 'success');
    } catch {
      toast('Unable to copy. Select the number manually instead.', 'error');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={conversation.kind === 'group' ? 'Group details' : 'Conversation details'}
      size="medium"
      footer={
        <button type="button" className="button button--secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="info-panel">
        <div className="info-identity">
          <Avatar
            name={title}
            seed={conversationSeed(conversation, myId)}
            dpUrl={conversationDpUrl(conversation, myId)}
            group={conversation.kind === 'group'}
            size="lg"
          />
          <div>
            <h3>{title}</h3>
            <p>{conversationHandle(conversation, myId)}</p>
          </div>
        </div>

        {conversation.kind === 'dm' && peer ? (
          <>
            <div className="info-grid">
              <div>
                <span>Username</span>
                <strong>@{peer.username}</strong>
              </div>
              <div>
                <span>Account</span>
                <strong>{peer.displayName}</strong>
              </div>
            </div>
            <div className="info-actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={isPending}
                onClick={() => void call(false)}
              >
                <Phone size={17} aria-hidden="true" /> Audio call
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={isPending}
                onClick={() => void call(true)}
              >
                <Video size={18} aria-hidden="true" /> Video call
              </button>
            </div>
            {safetyNumber ? (
              <div className="safety-number">
                <div>
                  <span>Safety number</span>
                  <strong>{safetyNumber}</strong>
                </div>
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  onClick={() => void copyFingerprint()}
                  aria-label="Copy safety number"
                >
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
            ) : null}
            <div className="info-note">
              <ShieldCheck size={17} aria-hidden="true" />
              <p>
                Compare this safety number with {peer.displayName} over another trusted channel.
                Both devices compute the exact same code when your connection is authentic.
              </p>
            </div>
          </>
        ) : (
          <>
            {isAdmin ? (
              <div className="rename-group">
                <label className="field">
                  <span>Group name</span>
                  <input
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    maxLength={48}
                  />
                </label>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void saveName()}
                  disabled={
                    renaming || !renameValue.trim() || renameValue.trim() === conversation.title
                  }
                >
                  {renaming ? (
                    <Loader2 className="spin" size={16} aria-hidden="true" />
                  ) : (
                    <Check size={16} aria-hidden="true" />
                  )}
                  Save
                </button>
              </div>
            ) : null}

            <div className="section-heading">
              <h4>Members</h4>
              <span>{conversation.members.length} of 50</span>
            </div>
            <div className="member-list">
              {conversation.members.map((member) => (
                <div className="member-row" key={member.userId}>
                  <Avatar
                    name={member.displayName}
                    seed={member.userId}
                    dpUrl={member.avatarUrl}
                    size="sm"
                  />
                  <div>
                    <strong>
                      {member.displayName}
                      {member.userId === myId ? ' (you)' : ''}
                    </strong>
                    <span>@{member.username}</span>
                  </div>
                  {member.role === 'admin' ? (
                    <span className="role-badge">
                      <Crown size={12} aria-hidden="true" /> Admin
                    </span>
                  ) : null}
                  {isAdmin && member.userId !== myId ? (
                    <button
                      type="button"
                      className={`text-button text-button--danger${
                        confirmRemove === member.userId ? ' is-confirming' : ''
                      }`}
                      onClick={() => void remove(member.userId, member.displayName)}
                    >
                      {confirmRemove === member.userId ? (
                        <>
                          <Check size={14} aria-hidden="true" /> Confirm
                        </>
                      ) : (
                        <>
                          <UserMinus size={14} aria-hidden="true" /> Remove
                        </>
                      )}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            {isAdmin ? (
              <div className="add-member">
                <div className="section-heading">
                  <h4>Add a member</h4>
                </div>
                <span className="input-prefix">
                  <Search size={16} aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) =>
                      setQuery(sanitizeUsernameInput(event.target.value.replace(/^@/, '')))
                    }
                    placeholder="Search @username"
                    maxLength={10}
                    autoComplete="off"
                    autoCapitalize="none"
                  />
                  {searching ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null}
                </span>
                {query.trim().length >= 2 ? (
                  <div className="search-results search-results--compact">
                    {results.map((person) => (
                      <button
                        type="button"
                        className="search-result"
                        key={person.id}
                        onClick={() => void add(person)}
                        disabled={adding !== null}
                      >
                        <Avatar
                          name={person.display_name}
                          seed={person.id}
                          dpUrl={person.avatar_url}
                          size="sm"
                        />
                        <span>
                          <strong>{person.display_name}</strong>
                          <small>@{person.username}</small>
                        </span>
                        {adding === person.id ? (
                          <Loader2 className="spin" size={16} aria-hidden="true" />
                        ) : (
                          <Plus size={17} aria-hidden="true" />
                        )}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="info-note">
              <ShieldCheck size={17} aria-hidden="true" />
              <p>
                Adding or removing a member rotates the group key automatically. Group messages
                disappear one minute after all other members have read them.
              </p>
            </div>

            <div className="danger-zone">
              <div>
                <strong>Leave this group</strong>
                <p>You will stop receiving group messages immediately.</p>
              </div>
              <button
                type="button"
                className={`button ${confirmLeave ? 'button--danger' : 'button--ghost'}`}
                onClick={() => void leave()}
                disabled={leaving}
              >
                {leaving ? (
                  <Loader2 className="spin" size={16} aria-hidden="true" />
                ) : confirmLeave ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <Trash2 size={16} aria-hidden="true" />
                )}
                {confirmLeave ? 'Confirm leave' : 'Leave group'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
