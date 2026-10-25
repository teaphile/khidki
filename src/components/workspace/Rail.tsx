import { MessageCircle, Settings, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import type { AppView } from '../../types';
import { Avatar } from '../ui/Avatar';
import { LogoMark } from '../ui/LogoMark';
import { ThemeToggle } from '../ui/ThemeToggle';

export function Rail({
  view,
  onView,
  onSettings,
}: {
  view: AppView;
  onView: (view: AppView) => void;
  onSettings: () => void;
}) {
  const { profile } = useAuth();
  const { unread } = useChat();
  const totalUnread = Object.values(unread).reduce((sum, count) => sum + count, 0);

  return (
    <aside className="rail" aria-label="Primary navigation">
      <div className="rail__logo" title="Sotto">
        <LogoMark size={38} />
      </div>

      <nav className="rail__nav">
        <button
          type="button"
          className={`rail-button${view === 'chats' ? ' is-active' : ''}`}
          onClick={() => onView('chats')}
          aria-label="Chats"
          aria-current={view === 'chats' ? 'page' : undefined}
          title="Chats"
        >
          <MessageCircle size={21} aria-hidden="true" />
          {totalUnread > 0 ? (
            <span className="rail-badge" aria-label={`${totalUnread} unread messages`}>
              {totalUnread > 9 ? '9+' : totalUnread}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className={`rail-button${view === 'people' ? ' is-active' : ''}`}
          onClick={() => onView('people')}
          aria-label="Discover people"
          aria-current={view === 'people' ? 'page' : undefined}
          title="Discover people"
        >
          <Users size={21} aria-hidden="true" />
        </button>
      </nav>

      <div className="rail__bottom">
        <ThemeToggle />
        <button
          type="button"
          className="rail-button"
          onClick={onSettings}
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="rail-avatar"
          onClick={onSettings}
          aria-label="Open account settings"
          title={profile?.display_name}
        >
          {profile ? <Avatar name={profile.display_name} seed={profile.id} size="small" /> : null}
        </button>
      </div>
    </aside>
  );
}
