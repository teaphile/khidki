import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPage } from '../../src/components/auth/AuthPage';
import { LinkDialog } from '../../src/components/workspace/LinkDialog';
import { MessageBubble } from '../../src/components/workspace/MessageBubble';
import { ThemeProvider } from '../../src/context/ThemeContext';
import { ToastProvider } from '../../src/context/ToastContext';
import { assessLink } from '../../src/lib/links';

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    configured: true,
    loading: false,
    session: null,
    user: null,
    profile: null,
    identity: null,
    vaultLocked: false,
    profileError: null,
    hadRecoverySession: false,
    stageLoginPassword: vi.fn(),
    unlockKeyVault: vi.fn(),
    rotateIdentityWithPassword: vi.fn(),
    refreshProfile: vi.fn(),
    signOut: vi.fn(),
  }),
}));

describe('AuthPage, MessageBubble & LinkDialog UI security regressions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    window.history.replaceState({}, '', '/');
  });

  it('removes the awkward 2:00 stamp and eliminates AI em-dashes across AuthPage', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <ThemeProvider>
            <ToastProvider>
              <AuthPage />
            </ToastProvider>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('.auth-story__stamp')).toBeNull();
    expect(container.textContent).toContain('Khidki');
    expect(container.textContent).not.toContain('Sotto');
    expect(container.textContent).not.toMatch(/2:00/);
    expect(container.textContent).not.toMatch(/Seen \+/i);
    expect(container.textContent).not.toContain('+');
    expect(container.textContent).not.toContain('—');
    expect(container.textContent).toMatch(/End-to-end encrypted/i);
    expect(container.textContent).toMatch(/1m after seen|one minute/i);
  });

  it('replaces preset stickers with an optional image-only DP control and enforces 3-10 alphanumeric username input on sign up', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <ThemeProvider>
            <ToastProvider>
              <AuthPage />
            </ToastProvider>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });

    const signUpTab = Array.from(container.querySelectorAll('[role="tab"]')).find((el) =>
      el.textContent?.includes('Sign up'),
    ) as HTMLButtonElement | undefined;
    expect(signUpTab).toBeDefined();

    await act(async () => {
      signUpTab?.click();
    });

    expect(container.querySelector('.avatar-picker')).toBeNull();
    expect(container.querySelector('.dp-control')).not.toBeNull();
    const dpFileInput = container.querySelector(
      '.dp-control input[type="file"]',
    ) as HTMLInputElement | null;
    expect(dpFileInput).not.toBeNull();
    expect(dpFileInput?.accept).toBe('image/*');
    expect(container.textContent).not.toContain('+');

    const usernameInput = container.querySelector(
      'input[autocomplete="username"]',
    ) as HTMLInputElement | null;
    expect(usernameInput).not.toBeNull();
    expect(usernameInput?.maxLength).toBe(10);
    expect(usernameInput?.minLength).toBe(3);
  });

  it('renders unseen messages as Waiting to be seen without edit or delete buttons', async () => {
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    await act(async () => {
      root.render(
        <MessageBubble
          message={{
            id: 'msg-1',
            conversationId: 'conv-1',
            senderId: 'user-1',
            senderName: 'Ashish',
            kind: 'text',
            text: 'Still waiting safely after 3 days offline',
            createdAt: threeDaysAgo,
            seenAt: null,
            expiresAt: null,
            mine: true,
            status: 'sent',
          }}
          showSender={false}
          onOpenLink={() => undefined}
        />,
      );
    });

    expect(container.textContent).toContain('Still waiting safely after 3 days offline');
    expect(container.textContent).toContain('Waiting to be seen');
    expect(container.textContent).not.toMatch(/edit|delete/i);
  });

  it('sanitizes untrusted URL error_description parameters against phishing injection', async () => {
    window.history.replaceState(
      {},
      '',
      '/?error=access_denied&error_description=Visit+https%3A%2F%2Fevil.example+to+unlock+account',
    );

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <ThemeProvider>
            <ToastProvider>
              <AuthPage />
            </ToastProvider>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).not.toContain('evil.example');
    expect(container.textContent).toContain(
      'Email verification could not be completed. Request a fresh link if needed.',
    );
    expect(window.location.search).toBe('');
  });

  it('explains blocked HTTPS links accurately without disabling an Open anyway button', async () => {
    const credentialLink = assessLink('https://admin:secret@example.com/login');
    expect(credentialLink).not.toBeNull();
    expect(credentialLink?.canOpen).toBe(false);

    await act(async () => {
      root.render(<LinkDialog link={credentialLink} onClose={() => undefined} />);
    });

    expect(document.body.textContent).toContain(
      'This link was blocked because it contains unsafe destination parameters.',
    );
    expect(document.body.textContent).toContain(
      'This link contains hidden credentials and cannot be opened safely.',
    );
    expect(document.body.textContent).not.toContain('Open anyway');
  });
});
