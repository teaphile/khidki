import { Inbox, MessageSquare, UserSearch } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { AppView } from '../../types';
import { Avatar } from '../ui/Avatar';

export function MobileNav({
  view,
  unreadTotal,
  requestCount,
  onSelectView,
  onOpenSettings,
}: {
  view: AppView;
  unreadTotal: number;
  requestCount: number;
  onSelectView: (view: AppView) => void;
  onOpenSettings: () => void;
}) {
  const { profile } = useAuth();

  return (
    <nav className="mobile-nav" aria-label="Primary">
      <button
        type="button"
        className={`mobile-nav__item${view === 'chats' ? ' is-active' : ''}`}
        onClick={() => onSelectView('chats')}
      >
        <span className="mobile-nav__icon-wrap">
          <MessageSquare size={19} aria-hidden="true" />
          {unreadTotal > 0 ? (
            <span className="mobile-nav__badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span>
          ) : null}
        </span>
        <span>Chats</span>
      </button>

      <button
        type="button"
        className={`mobile-nav__item${view === 'requests' ? ' is-active' : ''}`}
        onClick={() => onSelectView('requests')}
      >
        <span className="mobile-nav__icon-wrap">
          <Inbox size={19} aria-hidden="true" />
          {requestCount > 0 ? (
            <span className="mobile-nav__badge">{requestCount > 99 ? '99+' : requestCount}</span>
          ) : null}
        </span>
        <span>Requests</span>
      </button>

      <button
        type="button"
        className={`mobile-nav__item${view === 'people' ? ' is-active' : ''}`}
        onClick={() => onSelectView('people')}
      >
        <span className="mobile-nav__icon-wrap">
          <UserSearch size={19} aria-hidden="true" />
        </span>
        <span>People</span>
      </button>

      <button type="button" className="mobile-nav__item" onClick={onOpenSettings}>
        <span className="mobile-nav__icon-wrap">
          {profile ? (
            <Avatar
              name={profile.display_name}
              seed={profile.id}
              dpUrl={profile.avatar_url}
              size="sm"
            />
          ) : null}
        </span>
        <span>Profile</span>
      </button>
    </nav>
  );
}
