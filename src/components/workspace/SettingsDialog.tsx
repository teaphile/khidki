import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Loader2,
  LogOut,
  Mail,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { deleteAccount, updateProfile } from '../../lib/data';
import { fingerprint, publicBundle } from '../../lib/crypto';
import { supabase } from '../../lib/env';
import { clearIdentity } from '../../lib/identityStore';
import { displayNameSchema, firstIssue } from '../../lib/validation';
import type { AvatarId, ThemeMode } from '../../types';
import { Avatar } from '../ui/Avatar';
import { AvatarPicker } from '../ui/AvatarPicker';
import { Modal } from '../ui/Modal';

const THEMES: Array<{ mode: ThemeMode; label: string; icon: typeof Sun }> = [
  { mode: 'system', label: 'System', icon: Monitor },
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, identity, user, refreshProfile, signOut } = useAuth();
  const { mode, setMode } = useTheme();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [avatarId, setAvatarId] = useState<AvatarId>(profile?.avatar_id ?? 'initials');
  const [saving, setSaving] = useState(false);
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDisplayName(profile?.display_name ?? '');
    setAvatarId(profile?.avatar_id ?? 'initials');
    setDeleteMode(false);
    setDeleteConfirm('');
    setResetSent(false);
  }, [open, profile?.avatar_id, profile?.display_name]);

  useEffect(() => {
    if (!open || !identity) return;
    let active = true;
    void fingerprint(publicBundle(identity)).then((value) => {
      if (active) setSafetyNumber(value);
    });
    return () => {
      active = false;
    };
  }, [identity, open]);

  const hasProfileChanges = profile
    ? displayName.trim() !== profile.display_name || avatarId !== profile.avatar_id
    : false;

  const saveProfile = async () => {
    if (!profile) return;
    const parsed = displayNameSchema.safeParse(displayName);
    if (!parsed.success) {
      toast(firstIssue(parsed.error), 'error');
      return;
    }
    setSaving(true);
    try {
      await updateProfile(profile.id, {
        display_name: parsed.data,
        avatar_id: avatarId,
      });
      await refreshProfile();
      toast('Profile updated.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to update your profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const copyFingerprint = async () => {
    if (!safetyNumber) return;
    try {
      await navigator.clipboard.writeText(safetyNumber.replace(/\s/g, ''));
      toast('Device identity copied.', 'success');
    } catch {
      toast('Unable to copy. Select the number manually instead.', 'error');
    }
  };

  const sendPasswordReset = async () => {
    if (!supabase || !user?.email) return;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setResetSent(true);
      toast('Password reset link sent to your email.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to send the reset link.', 'error');
    }
  };

  const removeAccount = async () => {
    if (!profile || deleteConfirm !== profile.username) return;
    setDeleting(true);
    try {
      const deletingId = profile.id;
      const deletingEmail = user?.email ?? null;
      await deleteAccount();
      await clearIdentity(deletingId, deletingEmail);
      await signOut();
      toast('Your account and device keys have been deleted.', 'info');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to delete your account.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      description="Your profile sticker, appearance, and encryption security."
      size="medium"
      footer={
        <button type="button" className="button button--secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="settings-panel">
        <section className="settings-section">
          <div className="section-heading">
            <h4>Profile & display sticker</h4>
            <span>Username is permanent</span>
          </div>

          <div className="settings-avatar-preview">
            <Avatar
              name={displayName || profile?.display_name || 'You'}
              seed={profile?.id ?? 'you'}
              avatarId={avatarId}
              size="lg"
            />
            <div>
              <strong>{displayName || profile?.display_name}</strong>
              <span>@{profile?.username}</span>
            </div>
          </div>

          <AvatarPicker
            value={avatarId}
            onChange={setAvatarId}
            name={displayName || profile?.display_name || 'You'}
            seed={profile?.id ?? 'you'}
          />

          <div className="settings-row settings-row--profile">
            <label className="field">
              <span>Display name</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={36}
              />
            </label>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void saveProfile()}
              disabled={saving || !displayName.trim() || !hasProfileChanges}
            >
              {saving ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <Check size={16} aria-hidden="true" />
              )}
              Save
            </button>
          </div>

          <div className="info-grid">
            <div>
              <span>Username</span>
              <strong>@{profile?.username}</strong>
            </div>
            <div>
              <span>Email</span>
              <strong className="truncate">{user?.email}</strong>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-heading">
            <h4>Appearance</h4>
            <span>Light, dark, or system</span>
          </div>
          <div className="theme-options" role="radiogroup" aria-label="Theme">
            {THEMES.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  type="button"
                  key={option.mode}
                  role="radio"
                  aria-checked={mode === option.mode}
                  className={mode === option.mode ? 'is-active' : ''}
                  onClick={() => setMode(option.mode)}
                >
                  <Icon size={18} aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-section">
          <div className="section-heading">
            <h4>Encryption identity</h4>
            <span>Password-backed vault</span>
          </div>
          <div className="safety-number">
            <div>
              <span>Your identity fingerprint</span>
              <strong>{safetyNumber ?? 'Generating...'}</strong>
            </div>
            <button
              type="button"
              className="icon-button icon-button--small"
              onClick={() => void copyFingerprint()}
              aria-label="Copy device identity"
              disabled={!safetyNumber}
            >
              <Copy size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="info-note">
            <ShieldCheck size={17} aria-hidden="true" />
            <p>
              Your private keys are sealed in this browser and backed up in an encrypted vault
              locked with your password so unread messages stay readable even if you sign back in
              days later.
            </p>
          </div>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void sendPasswordReset()}
          >
            {resetSent ? (
              <RefreshCw size={16} aria-hidden="true" />
            ) : (
              <Mail size={16} aria-hidden="true" />
            )}
            {resetSent ? 'Send another password link' : 'Send password reset link'}
          </button>
        </section>

        <section className="settings-section">
          <div className="section-heading">
            <h4>Session</h4>
          </div>
          <div className="settings-row">
            <div>
              <strong>Sign out of this browser</strong>
              <p>Decrypted messages are cleared from device memory immediately.</p>
            </div>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void signOut()}
            >
              <LogOut size={16} aria-hidden="true" /> Sign out
            </button>
          </div>
        </section>

        <section className="settings-section settings-section--danger">
          <div className="section-heading">
            <h4>Delete account</h4>
          </div>
          {!deleteMode ? (
            <div className="settings-row">
              <div>
                <strong>Permanently remove your account</strong>
                <p>Profile, memberships, keys, and queued ciphertexts are erased.</p>
              </div>
              <button
                type="button"
                className="button button--ghost button--danger-text"
                onClick={() => setDeleteMode(true)}
              >
                <Trash2 size={16} aria-hidden="true" /> Delete
              </button>
            </div>
          ) : (
            <div className="delete-account">
              <p>
                This cannot be undone. Type <strong>{profile?.username}</strong> to confirm.
              </p>
              <div className="delete-account__row">
                <input
                  value={deleteConfirm}
                  onChange={(event) => setDeleteConfirm(event.target.value)}
                  placeholder={profile?.username}
                  autoComplete="off"
                  aria-label="Type your username to confirm account deletion"
                />
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => void removeAccount()}
                  disabled={deleting || deleteConfirm !== profile?.username}
                >
                  {deleting ? (
                    <Loader2 className="spin" size={16} aria-hidden="true" />
                  ) : (
                    <Trash2 size={16} aria-hidden="true" />
                  )}
                  Delete forever
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    setDeleteMode(false);
                    setDeleteConfirm('');
                  }}
                  disabled={deleting}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
