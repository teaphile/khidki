import { useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Loader2, MessageSquarePlus, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { useToast } from '../../context/ToastContext';
import { searchPeople } from '../../lib/data';
import { dmPeer } from '../../lib/format';
import { sanitizeUsernameInput } from '../../lib/validation';
import type { PeopleResult } from '../../types';
import { Avatar } from '../ui/Avatar';

export function PeoplePanel({ onConversationReady }: { onConversationReady: () => void }) {
  const { profile } = useAuth();
  const { conversations, startDirectMessage, setActiveId } = useChat();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PeopleResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const myId = profile?.id ?? '';

  const existingByPeerId = useMemo(() => {
    const map = new Map<string, { id: string; pending: boolean }>();
    for (const conv of conversations) {
      if (conv.kind !== 'dm') continue;
      const peer = dmPeer(conv, myId);
      if (peer) {
        map.set(peer.userId, {
          id: conv.id,
          pending: conv.requestStatus === 'pending',
        });
      }
    }
    return map;
  }, [conversations, myId]);

  useEffect(() => {
    const trimmed = query.trim().replace(/^@/, '').toLowerCase();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    const timer = window.setTimeout(() => {
      void searchPeople(trimmed)
        .then((people) => {
          if (requestId.current !== id) return;
          setResults(people);
        })
        .catch((caught: unknown) => {
          if (requestId.current !== id) return;
          setError(caught instanceof Error ? caught.message : 'Search failed.');
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [query]);

  const openDm = async (person: PeopleResult) => {
    const existing = existingByPeerId.get(person.id);
    if (existing) {
      setActiveId(existing.id);
      onConversationReady();
      return;
    }

    setStarting(person.id);
    try {
      await startDirectMessage(person);
      onConversationReady();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Unable to start conversation.', 'error');
    } finally {
      setStarting(null);
    }
  };

  return (
    <section className="panel" aria-label="Find people">
      <header className="panel__header">
        <div>
          <span className="eyebrow">Directory</span>
          <h1>Find people</h1>
        </div>
      </header>

      <label className="search-field">
        <Search size={16} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) =>
            setQuery(sanitizeUsernameInput(event.target.value.replace(/^@/, '')))
          }
          placeholder="Search @username (a-z, 0-9)"
          aria-label="Search by username"
          maxLength={10}
          autoCapitalize="none"
          spellCheck={false}
        />
        {loading ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null}
      </label>

      <div className="panel__body">
        {query.trim().length < 2 ? (
          <div className="empty-card">
            <AtSign size={24} aria-hidden="true" />
            <h2>Search by username</h2>
            <p>
              Enter at least two letters or numbers of someone&apos;s username to send a message
              request.
            </p>
          </div>
        ) : error ? (
          <div className="empty-card">
            <p>{error}</p>
          </div>
        ) : !loading && !results.length ? (
          <div className="empty-card">
            <h2>No verified user found</h2>
            <p>Check the exact 3 to 10 character username and make sure they verified email.</p>
          </div>
        ) : (
          <ul className="people-list">
            {results.map((person) => {
              const existing = existingByPeerId.get(person.id);
              return (
                <li key={person.id} className="person-row">
                  <Avatar name={person.display_name} seed={person.id} dpUrl={person.avatar_url} />
                  <div className="person-row__meta">
                    <strong className="truncate">{person.display_name}</strong>
                    <span className="truncate">@{person.username}</span>
                  </div>
                  <button
                    type="button"
                    className="button button--secondary button--compact"
                    disabled={starting === person.id}
                    onClick={() => void openDm(person)}
                    aria-label={
                      existing?.pending
                        ? `Open pending request with ${person.display_name}; no expiry`
                        : existing
                          ? `Open conversation with ${person.display_name}`
                          : `Message ${person.display_name}`
                    }
                    title={
                      existing?.pending
                        ? 'This request does not expire. Open it to cancel.'
                        : existing
                          ? 'Open existing conversation'
                          : 'Send a message request'
                    }
                  >
                    {starting === person.id ? (
                      <Loader2 className="spin" size={15} aria-hidden="true" />
                    ) : (
                      <MessageSquarePlus size={15} aria-hidden="true" />
                    )}
                    {existing ? (existing.pending ? 'Pending' : 'Open') : 'Message'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
