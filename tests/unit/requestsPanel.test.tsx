import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestsPanel } from '../../src/components/workspace/RequestsPanel';

const { acceptRequest, declineRequest, setActiveId, toast } = vi.hoisted(() => ({
  acceptRequest: vi.fn(),
  declineRequest: vi.fn(),
  setActiveId: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'me' } }),
}));

vi.mock('../../src/context/ChatContext', () => ({
  useChat: () => ({
    incomingRequests: [
      {
        id: 'conversation-1',
        kind: 'dm',
        title: '',
        createdBy: 'sender-1',
        createdAt: '2026-10-20T10:00:00.000Z',
        lastMessageAt: '2026-10-20T10:00:00.000Z',
        requestStatus: 'pending',
        requestedBy: 'sender-1',
        members: [
          {
            userId: 'me',
            username: 'myuser',
            displayName: 'My User',
            avatarUrl: null,
            publicKey: null,
            role: 'member',
          },
          {
            userId: 'sender-1',
            username: 'aum',
            displayName: 'Aum',
            avatarUrl: null,
            publicKey: null,
            role: 'member',
          },
        ],
      },
    ],
    messages: {},
    unread: {},
    activeId: null,
    setActiveId,
    acceptRequest,
    declineRequest,
  }),
}));

vi.mock('../../src/context/ToastContext', () => ({
  useToast: () => ({ toast }),
}));

afterEach(cleanup);

describe('message request management', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    acceptRequest.mockResolvedValue(undefined);
    declineRequest.mockResolvedValue(undefined);
  });

  it('shows pending requests with a non-countdown date and makes their no-expiry state clear', () => {
    render(<RequestsPanel onAccepted={vi.fn()} />);

    expect(screen.getByText(/Requests have no expiry/)).toBeInTheDocument();
    expect(screen.getByText('Pending · no expiry')).toBeInTheDocument();
    expect(screen.getByText('Oct 20, 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open request from Aum' })).toBeInTheDocument();
  });

  it('keeps working accept and remove actions for managing requests', async () => {
    render(<RequestsPanel onAccepted={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(acceptRequest).toHaveBeenCalledWith('conversation-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(declineRequest).toHaveBeenCalledWith('conversation-1'));
  });
});
