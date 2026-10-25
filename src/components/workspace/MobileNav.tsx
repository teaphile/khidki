import { MessageCircle, Settings, Users } from 'lucide-react';
import type { AppView } from '../../types';

export function MobileNav({
  view,
  onView,
  onSettings,
}: {
  view: AppView;
  onView: (view: AppView) => void;
  onSettings: () => void;
}) {
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      <button
        type="button"
        className={view === 'chats' ? 'is-active' : ''}
        onClick={() => onView('chats')}
        aria-current={view === 'chats' ? 'page' : undefined}
      >
        <MessageCircle size={20} aria-hidden="true" />
        <span>Chats</span>
      </button>
      <button
        type="button"
        className={view === 'people' ? 'is-active' : ''}
        onClick={() => onView('people')}
        aria-current={view === 'people' ? 'page' : undefined}
      >
        <Users size={20} aria-hidden="true" />
        <span>People</span>
      </button>
      <button type="button" onClick={onSettings}>
        <Settings size={20} aria-hidden="true" />
        <span>Settings</span>
      </button>
    </nav>
  );
}
