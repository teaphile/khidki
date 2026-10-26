import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPage } from '../../src/components/auth/AuthPage';
import { LinkDialog } from '../../src/components/workspace/LinkDialog';
import { ThemeProvider } from '../../src/context/ThemeContext';
import { ToastProvider } from '../../src/context/ToastContext';
import { assessLink } from '../../src/lib/links';

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    status: 'signed_out',
    session: null,
    profile: null,
    identity: null,
    emailVerified: false,
    hadRecoverySession: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
    updateDisplayName: vi.fn(),
    deleteAccount: vi.fn(),
  }),
}));

describe('AuthPage & LinkDialog UI security regressions', () => {
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

  it('removes the awkward 2-minute stamp and footer highlight from the starting page', async () => {
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
    expect(container.textContent).not.toMatch(/2:00/);
    expect(container.textContent).not.toMatch(/then gone/i);
    expect(container.textContent).not.toMatch(/2 minutes/i);
    expect(container.textContent).toMatch(/End-to-end encrypted · Zero message archive/i);
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
