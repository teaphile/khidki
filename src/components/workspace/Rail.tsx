import { Inbox, MessageSquare, Settings, UserSearch, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { AppView } from '../../types';
import { Avatar } from '../ui/Avatar';
import { LogoMark } from '../ui/LogoMark';
import { ThemeToggle } from '../ui/ThemeToggle';

export function Rail({
  view,
  unreadTotal,
  requestCount,
  onSelectView,
  onOpenNewGroup,
  onOpenSettings,
}: {
  view: AppView;
  unreadTotal: number;
  requestCount: number;
  onSelectView: (view: AppView) => void;
  onOpenNewGroup: () => void;
  onOpenSettings: () => void;
}) {
  const { profile } = useAuth();

  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail__brand" title="Sotto">
        <LogoMark size={30} />
      </div>

      <div className="rail__nav">
        <button
          type="button"
          className={`rail-button${view === 'chats' ? ' is-active' : ''}`}
          onClick={() => onSelectView('chats')}
          aria-label="Chats"
          title="Chats"
        >
          <MessageSquare size={20} aria-hidden="true" />
          {unreadTotal > 0 ? (
            <span className="rail-badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span>
          ) : null}
        </button>

        <button
          type="button"
          className={`rail-button${view === 'requests' ? ' is-active' : ''}`}
          onClick={() => onSelectView('requests')}
          aria-label="Message requests"
          title="Message requests"
        >
          <Inbox size={20} aria-hidden="true" />
          {requestCount > 0 ? (
            <span className="rail-badge">{requestCount > 99 ? '99+' : requestCount}</span>
          ) : null}
        </button>

        <button
          type="button"
          className={`rail-button${view === 'people' ? ' is-active' : ''}`}
          onClick={() => onSelectView('people')}
          aria-label="Find people"
          title="Find people"
        >
          <UserSearch size={20} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="rail-button"
          onClick={onOpenNewGroup}
          aria-label="New group"
          title="New group"
        >
          <Users size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="rail__footer">
        <ThemeToggle />
        <button
          type="button"
          className="rail-button"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={19} aria-hidden="true" />
        </button>
        {profile ? (
          <button
            type="button"
            className="rail-avatar"
            onClick={onOpenSettings}
            aria-label={`Account settings for ${profile.display_name}`}
            title={`${profile.display_name} (@${profile.username})`}
          >
            <Avatar
              name={profile.display_name}
              seed={profile.id}
              avatarId={profile.avatar_id}
              size="sm"
            />
          </button>
        ) : null}
      </div>
    </nav>
  );
}
