import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  createUserChannel,
  type HubConnectionLike,
} from '../api/userChannel';
import { useUserChannel } from './useUserChannel';

function createFakeHub() {
  let receiveHandler: ((...args: unknown[]) => void) | null = null;
  let reconnectingCb: ((err?: Error) => void) | null = null;
  let reconnectedCb: ((id?: string) => void) | null = null;
  let closeCb: ((err?: Error) => void) | null = null;

  const hub: HubConnectionLike = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    on: vi.fn((method, handler) => {
      if (method === 'Receive') receiveHandler = handler;
    }),
    off: vi.fn(),
    invoke: vi.fn(async () => ({ accepted: true, reason: null })) as unknown as HubConnectionLike['invoke'],
    onreconnecting: vi.fn((cb) => {
      reconnectingCb = cb;
    }),
    onreconnected: vi.fn((cb) => {
      reconnectedCb = cb;
    }),
    onclose: vi.fn((cb) => {
      closeCb = cb;
    }),
  };

  return {
    hub,
    emitReceive: (env: unknown) => receiveHandler?.(env),
    emitReconnecting: () => reconnectingCb?.(),
    emitReconnected: () => reconnectedCb?.('conn-2'),
    emitClose: () => closeCb?.(),
  };
}

describe('useUserChannel', () => {
  it('tracks connecting -> connected -> reconnecting -> connected and fires onReconnect', async () => {
    const fake = createFakeHub();
    const onReconnect = vi.fn();

    const { result, unmount } = renderHook(() =>
      useUserChannel({
        channelFactory: () => createUserChannel({ hubFactory: () => fake.hub }),
        onReconnect,
      }),
    );

    await waitFor(() => expect(result.current.connectionState).toBe('connected'));

    act(() => {
      fake.emitReconnecting();
    });
    expect(result.current.connectionState).toBe('reconnecting');

    act(() => {
      fake.emitReconnected();
    });
    expect(result.current.connectionState).toBe('connected');
    expect(onReconnect).toHaveBeenCalledTimes(1);

    act(() => {
      fake.emitClose();
    });
    expect(result.current.connectionState).toBe('disconnected');

    unmount();
    expect(fake.hub.stop).toHaveBeenCalled();
  });
});
