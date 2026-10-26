import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rail } from '../../src/components/workspace/Rail';
import { ThemeProvider } from '../../src/context/ThemeContext';

const { profile } = vi.hoisted(() => ({
  profile: {
    id: 'profile-1',
    username: 'aum01',
    display_name: 'Aum',
    avatar_url: null,
  },
}));

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ profile }),
}));

afterEach(cleanup);

describe('desktop account navigation', () => {
  it('keeps one profile-and-settings entry point', () => {
    const onOpenSettings = vi.fn();
    render(
      <ThemeProvider>
        <Rail
          view="chats"
          unreadTotal={0}
          requestCount={0}
          onSelectView={vi.fn()}
          onOpenNewGroup={vi.fn()}
          onOpenSettings={onOpenSettings}
        />
      </ThemeProvider>,
    );

    expect(
      screen.getByRole('button', { name: 'Profile and settings for Aum' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Profile and settings for Aum' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
