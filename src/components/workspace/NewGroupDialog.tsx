import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Search, Users, X } from 'lucide-react';
import { useChat } from '../../context/ChatContext';
import { useToast } from '../../context/ToastContext';
import { searchPeople } from '../../lib/data';
import { groupTitleSchema } from '../../lib/validation';
import type { PeopleResult } from '../../types';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';

export function NewGroupDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const { createGroupChat } = useChat();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PeopleResult[]>([]);
  const [selected, setSelected] = useState<PeopleResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setQuery('');
    setResults([]);
    setSelected([]);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
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
          setResults(people.filter((person) => !selected.some((item) => item.id === person.id)));
        })
        .catch(() => {
          if (requestId.current === id) setResults([]);
        })
        .finally(() => {
          if (requestId.current === id) setSearching(false);
        });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [open, query, selected]);

  const addPerson = (person: PeopleResult) => {
    if (selected.length >= 49) {
      setError('Groups are limited to 50 people.');
      return;
    }
    setSelected((current) => [...current, person]);
    setQuery('');
    setResults([]);
    setError(null);
  };

  const create = async () => {
    setError(null);
    const parsed = groupTitleSchema.safeParse(title);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Add a group name.');
      return;
    }
    if (!selected.length) {
      setError('Add at least one other person.');
      return;
    }
    setCreating(true);
    try {
      const id = await createGroupChat(parsed.data, selected);
      toast('Group created. Messages and files are still ephemeral.', 'success');
      onCreated(id);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create the group.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!creating) onClose();
      }}
      title="Create a group"
      description="Up to 50 people. Every member receives the conversation key on this device."
      size="medium"
      footer={
        <>
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
            disabled={creating}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void create()}
            disabled={creating || !selected.length || !title.trim()}
          >
            {creating ? (
              <Loader2 className="spin" size={17} aria-hidden="true" />
            ) : (
              <Users size={17} aria-hidden="true" />
            )}
            Create group
          </button>
        </>
      }
    >
      <div className="dialog-form">
        <label className="field">
          <span>Group name</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Weekend plans"
            maxLength={64}
            autoFocus
          />
        </label>

        <div className="field">
          <span>Add people by username</span>
          <span className="input-prefix">
            <Search size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
              autoComplete="off"
              maxLength={40}
            />
            {searching ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null}
          </span>
        </div>

        {selected.length ? (
          <div className="selected-people" aria-label="Selected people">
            {selected.map((person) => (
              <span className="person-chip" key={person.id}>
                <Avatar name={person.display_name} seed={person.id} size="small" />
                <span>{person.display_name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setSelected((current) => current.filter((item) => item.id !== person.id))
                  }
                  aria-label={`Remove ${person.display_name}`}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {query.trim().length >= 2 ? (
          <div className="search-results search-results--compact">
            {results.map((person) => (
              <button
                type="button"
                className="search-result"
                key={person.id}
                onClick={() => addPerson(person)}
              >
                <Avatar name={person.display_name} seed={person.id} size="small" />
                <span>
                  <strong>{person.display_name}</strong>
                  <small>@{person.username}</small>
                </span>
                <Plus size={17} aria-hidden="true" />
              </button>
            ))}
            {!searching && !results.length ? (
              <p className="search-empty">No more people matched that username.</p>
            ) : null}
          </div>
        ) : null}

        <p className="dialog-hint">
          Selected: {selected.length} of 49 others. You are added automatically as the first admin.
        </p>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
