import { useEffect, useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { readEnterToSendPreference, writeEnterToSendPreference } from '../../lib/preferences';
import type { AppView } from '../../types';
import { ConversationInfoDialog } from './ConversationInfoDialog';
import { ConversationList } from './ConversationList';
import { ConversationView } from './ConversationView';
import { MobileNav } from './MobileNav';
import { NewGroupDialog } from './NewGroupDialog';
import { PeoplePanel } from './PeoplePanel';
import { Rail } from './Rail';
import { RequestsPanel } from './RequestsPanel';
import { SettingsDialog } from './SettingsDialog';

export function Workspace() {
  const { activeConversation, activeId, setActiveId, totalUnreadChats, incomingRequestCount } =
    useChat();
  const [view, setView] = useState<AppView>('chats');
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [enterToSend, setEnterToSend] = useState(readEnterToSendPreference);

  const changeEnterToSend = (enabled: boolean) => {
    setEnterToSend(enabled);
    writeEnterToSendPreference(enabled);
  };

  const totalAlerts = totalUnreadChats + incomingRequestCount;

  useEffect(() => {
    document.title = totalAlerts > 0 ? `(${totalAlerts}) Khidki` : 'Khidki | Private Messenger';
    return () => {
      document.title = 'Khidki | Private Messenger';
    };
  }, [totalAlerts]);

  const handleSelectView = (next: AppView) => {
    setView(next);
    setActiveId(null);
  };

  return (
    <div className={`workspace${activeId ? ' workspace--has-active' : ''}`}>
      <Rail
        view={view}
        unreadTotal={totalUnreadChats}
        requestCount={incomingRequestCount}
        onSelectView={setView}
        onOpenNewGroup={() => setNewGroupOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <aside className="sidebar" aria-label={view}>
        {view === 'chats' ? (
          <ConversationList
            onOpenPeople={() => setView('people')}
            onOpenRequests={() => setView('requests')}
            onOpenNewGroup={() => setNewGroupOpen(true)}
          />
        ) : view === 'requests' ? (
          <RequestsPanel onAccepted={() => setView('chats')} />
        ) : (
          <PeoplePanel onConversationReady={() => setView('chats')} />
        )}
      </aside>

      <main className="stage" aria-label="Conversation">
        <ConversationView
          enterToSend={enterToSend}
          onBack={() => setActiveId(null)}
          onOpenInfo={() => setInfoOpen(true)}
          onOpenPeople={() => setView('people')}
          onOpenNewGroup={() => setNewGroupOpen(true)}
        />
      </main>

      <MobileNav
        view={view}
        unreadTotal={totalUnreadChats}
        requestCount={incomingRequestCount}
        onSelectView={handleSelectView}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <NewGroupDialog
        open={newGroupOpen}
        onClose={() => setNewGroupOpen(false)}
        onCreated={() => setView('chats')}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        enterToSend={enterToSend}
        onEnterToSendChange={changeEnterToSend}
      />

      {activeConversation ? (
        <ConversationInfoDialog
          conversation={activeConversation}
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
        />
      ) : null}
    </div>
  );
}
