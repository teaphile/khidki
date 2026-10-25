import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Search, SearchX, ShieldCheck, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { useToast } from '../../context/ToastContext';
import { searchPeople } from '../../lib/data';
import type { PeopleResult } from '../../types';
import { Avatar } from '../ui/Avatar';

export function PeoplePanel({ onConversationStarted }: { onConversationStarted: () => void }) {
  const { profile } = useAuth();
  const { startDirectMessage } = useChat();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PeopleResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [searched, setSearched] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError(null);
      setSearching(false);
      setSearched('');
      return;
    }

    const id = ++requestId.current;
    setSearching(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void searchPeople(trimmed)
        .then((people) => {
          if (requestId.current !== id) return;
          setResults(people);
          setSearched(trimmed);
        })
        .catch((caught: unknown) => {
          if (requestId.current !== id) return;
          setError(caught instanceof Error ? caught.message : 'Unable to search for people.');
          setResults([]);
        })
        .finally(() => {
          if (requestId.current === id) setSearching(false);
        });
    }, 280);

    return () => window.clearTimeout(timer);
  }, [query]);

  const start = async (person: PeopleResult) => {
    setStarting(person.id);
    try {
      await startDirectMessage(person);
      onConversationStarted();
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : 'Unable to start the conversation.',
        'error',
      );
    } finally {
      setStarting(null);
    }
  };

  const trimmed = query.trim();

  return (
    <div className="list-view people-view">
      <header className="list-header">
        <div>
          <span className="eyebrow">Discovery</span>
          <h1>People</h1>
        </div>
        <span className="header-emblem" aria-hidden="true">
          <UserPlus size={19} />
        </span>
      </header>

      <p className="panel-intro">
        Find someone by their username. You need at least two characters, and only verified accounts
        appear.
      </p>

      <div className="list-search">
        <Search size={17} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by username"
          aria-label="Search people by username"
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
        />
        {searching ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null}
      </div>

      <div className="people-scroll">
        {trimmed.length < 2 ? (
          <div className="empty-panel">
            <span className="empty-panel__icon">
              <Search size={21} aria-hidden="true" />
            </span>
            <strong>Search by username</strong>
            <p>Usernames are unique and cannot be changed. Ask the person for theirs.</p>
          </div>
        ) : null}

        {error ? (
          <div className="empty-panel">
            <span className="empty-panel__icon">
              <SearchX size={21} aria-hidden="true" />
            </span>
            <strong>Search is unavailable</strong>
            <p>{error}</p>
          </div>
        ) : null}

        {!error && trimmed.length >= 2 && !searching && searched && !results.length ? (
          <div className="empty-panel">
            <span className="empty-panel__icon">
              <SearchX size={21} aria-hidden="true" />
            </span>
            <strong>No one found</strong>
            <p>Check the spelling. Search matches usernames from the beginning.</p>
          </div>
        ) : null}

        {results.length ? (
          <div className="people-results" role="list" aria-label="People">
            {results.map((person) => (
              <div className="person-card" key={person.id} role="listitem">
                <Avatar name={person.display_name} seed={person.id} />
                <div className="person-card__details">
                  <strong>{person.display_name}</strong>
                  <span>@{person.username}</span>
                </div>
                <button
                  type="button"
                  className="button button--secondary button--compact"
                  onClick={() => void start(person)}
                  disabled={starting !== null || person.id === profile?.id}
                >
                  {starting === person.id ? (
                    <Loader2 className="spin" size={16} aria-hidden="true" />
                  ) : (
                    <MessageCircle size={16} aria-hidden="true" />
                  )}
                  Message
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="privacy-note">
          <ShieldCheck size={17} aria-hidden="true" />
          <p>
            Search only reveals verified profiles. Your email address is never shown to other
            people.
          </p>
        </div>
      </div>
    </div>
  );
}
