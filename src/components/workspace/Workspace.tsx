import { useEffect, useState } from 'react';
import { ArrowRight, Lock, MessageCircle, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import type { AppView } from '../../types';
import type { LinkAssessment } from '../../lib/links';
import { LogoMark } from '../ui/LogoMark';
import { ConversationInfoDialog } from './ConversationInfoDialog';
import { ConversationList } from './ConversationList';
import { ConversationView } from './ConversationView';
import { LinkDialog } from './LinkDialog';
import { MobileNav } from './MobileNav';
import { NewGroupDialog } from './NewGroupDialog';
import { PeoplePanel } from './PeoplePanel';
import { Rail } from './Rail';
import { SettingsDialog } from './SettingsDialog';

export function Workspace() {
  const { profile } = useAuth();
  const { activeConversation, setActiveId, unread, conversations } = useChat();
  const [view, setView] = useState<AppView>('chats');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [link, setLink] = useState<LinkAssessment | null>(null);

  const totalUnread = Object.values(unread).reduce((sum, count) => sum + count, 0);

  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) Sotto` : 'Sotto — private conversations';
    return () => {
      document.title = 'Sotto — private conversations';
    };
  }, [totalUnread]);

  const selectConversation = (id: string) => {
    setActiveId(id);
    setView('chats');
    setInfoOpen(false);
  };

  return (
    <div className="workspace" data-view={view} data-active={activeConversation ? 'true' : 'false'}>
      <Rail
        view={view}
        onView={(next) => {
          setView(next);
          if (next === 'people') setInfoOpen(false);
        }}
        onSettings={() => setSettingsOpen(true)}
      />

      <section className="list-pane" aria-label={view === 'chats' ? 'Chats' : 'People'}>
        <div className="list-pane__content">
          {view === 'chats' ? (
            <ConversationList
              onSelect={(conversation) => selectConversation(conversation.id)}
              onNewGroup={() => setGroupDialogOpen(true)}
              onFindPeople={() => setView('people')}
            />
          ) : (
            <PeoplePanel
              onConversationStarted={() => {
                setView('chats');
              }}
            />
          )}
        </div>
        <MobileNav view={view} onView={setView} onSettings={() => setSettingsOpen(true)} />
      </section>

      <main className="chat-pane" aria-label="Conversation">
        {activeConversation ? (
          <ConversationView
            key={activeConversation.id}
            conversation={activeConversation}
            onBack={() => setActiveId(null)}
            onOpenInfo={() => setInfoOpen(true)}
            onOpenLink={setLink}
          />
        ) : (
          <div className="welcome-pane">
            <div className="welcome-pane__inner">
              <span className="welcome-pane__mark">
                <LogoMark size={64} />
              </span>
              <span className="eyebrow">Private conversations. Nothing kept.</span>
              <h1>Speak freely. Leave no archive.</h1>
              <p>
                Choose a conversation, find someone by username, or start a small group. Messages
                and files are encrypted in your browser and disappear after two minutes.
              </p>
              <div className="welcome-pane__actions">
                {conversations.length ? (
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => {
                      const first = conversations[0];
                      if (first) selectConversation(first.id);
                    }}
                  >
                    <MessageCircle size={17} aria-hidden="true" /> Open latest chat
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setView('people')}
                >
                  Find people
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setGroupDialogOpen(true)}
                >
                  <Users size={17} aria-hidden="true" /> New group
                </button>
              </div>
              <div className="welcome-pane__facts">
                <span>
                  <Lock size={15} aria-hidden="true" /> End-to-end encrypted
                </span>
                <span>
                  <ShieldCheck size={15} aria-hidden="true" /> No message history
                </span>
              </div>
              <span className="welcome-user">Signed in as {profile?.display_name}</span>
            </div>
          </div>
        )}
      </main>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <NewGroupDialog
        open={groupDialogOpen}
        onClose={() => setGroupDialogOpen(false)}
        onCreated={(id) => {
          setActiveId(id);
          setView('chats');
        }}
      />
      {activeConversation ? (
        <ConversationInfoDialog
          conversation={activeConversation}
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
        />
      ) : null}
      <LinkDialog link={link} onClose={() => setLink(null)} />
    </div>
  );
}
