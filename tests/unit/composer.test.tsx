import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../../src/components/workspace/Composer';

const { sendText, sendFile, toast } = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendFile: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../src/context/ChatContext', () => ({
  useChat: () => ({ activeId: 'conversation-1', sendText, sendFile }),
}));

vi.mock('../../src/context/ToastContext', () => ({
  useToast: () => ({ toast }),
}));

afterEach(cleanup);

describe('message composer keyboard preference', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    sendText.mockResolvedValue(undefined);
    sendFile.mockResolvedValue(undefined);
  });

  it('sends with Enter when the preference is enabled', async () => {
    render(<Composer enterToSend />);
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Hello there' } });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(sendText).toHaveBeenCalledWith('Hello there');
  });

  it('keeps Enter as a newline when the preference is disabled', async () => {
    render(<Composer enterToSend={false} />);
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Keep writing' } });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(sendText).not.toHaveBeenCalled();
  });

  it('keeps Shift+Enter as a newline even when Enter sends', async () => {
    render(<Composer enterToSend />);
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Two lines' } });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    });

    expect(sendText).not.toHaveBeenCalled();
  });

  it('does not submit Enter while an input method editor is composing text', async () => {
    render(<Composer enterToSend />);
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Composing text' } });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    });

    expect(sendText).not.toHaveBeenCalled();
  });
});
