import { useEffect, useState } from 'react';
import { Check, Loader2, LogOut, Monitor, Moon, Sun, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { deleteAccount, updateProfile } from '../../lib/data';
import { clearIdentity } from '../../lib/identityStore';
import { displayNameSchema, firstIssue } from '../../lib/validation';
import type { ThemeMode } from '../../types';
import { DpUploadControl } from '../ui/DpUploadControl';
import { Modal } from '../ui/Modal';

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, user, refreshProfile, signOut } = useAuth();
  const { mode, setMode } = useTheme();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [dpUrl, setDpUrl] = useState<string | null>(profile?.avatar_url ?? null);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open && profile) {
      setDisplayName(profile.display_name);
      setDpUrl(profile.avatar_url ?? null);
      setConfirmDelete('');
    }
  }, [open, profile]);

  if (!profile) return null;

  const hasProfileChanges =
    displayName.trim() !== profile.display_name || (dpUrl ?? null) !== (profile.avatar_url ?? null);

  const handleSave = async () => {
    const parsed = displayNameSchema.safeParse(displayName);
    if (!parsed.success) {
      toast(firstIssue(parsed.error), 'error');
      return;
    }
    setSaving(true);
    try {
      await updateProfile(profile.id, { display_name: parsed.data, avatar_url: dpUrl });
      await refreshProfile();
      toast('Profile saved.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to save profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      onClose();
    } finally {
      setSigningOut(false);
    }
  };

  const handleDelete = async () => {
    if (confirmDelete.trim().toLowerCase() !== profile.username.toLowerCase()) return;
    setDeleting(true);
    try {
      const userId = profile.id;
      const email = user?.email ?? null;
      await deleteAccount();
      await clearIdentity(userId, email).catch(() => undefined);
      await signOut();
      toast('Your account and all cloud data were permanently deleted.', 'info');
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to delete account.', 'error');
      setDeleting(false);
    }
  };

  const themes: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Account settings"
      description={`@${profile.username}${user?.email ? ` · ${user.email}` : ''}`}
      size="medium"
      footer={
        <>
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
            disabled={saving || deleting}
          >
            Close
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void handleSave()}
            disabled={saving || deleting || !hasProfileChanges}
          >
            {saving ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : (
              <Check size={16} aria-hidden="true" />
            )}
            Save profile
          </button>
        </>
      }
    >
      <div className="settings-stack">
        <section className="settings-section">
          <DpUploadControl
            name={displayName || profile.display_name}
            seed={profile.id}
            value={dpUrl}
            onChange={setDpUrl}
            disabled={saving || deleting}
          />

          <div className="settings-meta-grid">
            <label className="field">
              <span>Display name</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={36}
              />
            </label>
            <label className="field">
              <span>Username</span>
              <input value={`@${profile.username}`} readOnly aria-readonly="true" />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <span className="section-label">Appearance</span>
          <div className="segmented" role="radiogroup" aria-label="Color theme">
            {themes.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                className={mode === value ? 'is-active' : ''}
                onClick={() => setMode(value)}
              >
                <Icon size={15} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section settings-section--session">
          <div className="settings-session-copy">
            <span className="section-label">Log out</span>
            <p className="muted-note">
              Signs out on this device only. Your username, DP, and encrypted key vault remain safe
              in cloud for your next sign in.
            </p>
          </div>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void handleSignOut()}
            disabled={signingOut || deleting}
          >
            {signingOut ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : (
              <LogOut size={16} aria-hidden="true" />
            )}
            Log out
          </button>
        </section>

        <section className="settings-section settings-section--danger">
          <span className="section-label">Delete account permanently</span>
          <p className="muted-note">
            Erases your login, username, DP, encrypted key vault, messages, call signals, and
            conversations from cloud and this device. Type <strong>{profile.username}</strong> to
            confirm.
          </p>
          <div className="settings-danger-row">
            <input
              className="danger-input"
              value={confirmDelete}
              onChange={(event) => setConfirmDelete(event.target.value)}
              placeholder={profile.username}
              aria-label={`Type ${profile.username} to confirm deletion`}
            />
            <button
              type="button"
              className="button button--danger"
              disabled={
                deleting || confirmDelete.trim().toLowerCase() !== profile.username.toLowerCase()
              }
              onClick={() => void handleDelete()}
            >
              {deleting ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <Trash2 size={16} aria-hidden="true" />
              )}
              Delete account
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
