import { useEffect, useRef } from 'react';
import { getInboxSocket, isRealtimeClientEnabled, refreshInboxSocketAuth } from '../realtime/socketClient';

interface UseRealtimeInboxArgs {
  onConversationCreated: (payload: unknown) => void;
  onConversationUpdated: (payload: unknown) => void;
  onMessageCreated: (payload: unknown) => void;
  onMessageUpdated?: (payload: unknown) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export function useRealtimeInbox({
  onConversationCreated,
  onConversationUpdated,
  onMessageCreated,
  onMessageUpdated,
  onConnectionChange,
}: UseRealtimeInboxArgs): void {
  const createdRef = useRef(onConversationCreated);
  const updatedRef = useRef(onConversationUpdated);
  const messageCreatedRef = useRef(onMessageCreated);
  const messageUpdatedRef = useRef(onMessageUpdated);
  const connectionChangeRef = useRef(onConnectionChange);

  createdRef.current = onConversationCreated;
  updatedRef.current = onConversationUpdated;
  messageCreatedRef.current = onMessageCreated;
  messageUpdatedRef.current = onMessageUpdated;
  connectionChangeRef.current = onConnectionChange;

  useEffect(() => {
    console.info('[RealtimeInbox] enabled flag', {
      VITE_REALTIME_ENABLED: String(import.meta.env.VITE_REALTIME_ENABLED ?? ''),
      enabled: isRealtimeClientEnabled(),
    });
    if (!isRealtimeClientEnabled()) {
      console.info('[RealtimeInbox] socket disabled by env');
      connectionChangeRef.current?.(false);
      return;
    }
    refreshInboxSocketAuth();
    const socket = getInboxSocket();
    if (!socket) {
      connectionChangeRef.current?.(false);
      return;
    }

    const handleCreated = (payload: unknown) => createdRef.current(payload);
    const handleUpdated = (payload: unknown) => {
      console.info('[RealtimeInbox] conversation.updated received', payload);
      updatedRef.current(payload);
    };
    const handleMessageCreated = (payload: unknown) => messageCreatedRef.current(payload);
    const handleMessageUpdated = (payload: unknown) => messageUpdatedRef.current?.(payload);
    const handleConnect = () => connectionChangeRef.current?.(true);
    const handleDisconnect = () => connectionChangeRef.current?.(false);

    socket.on('conversation.created', handleCreated);
    socket.on('conversation.updated', handleUpdated);
    socket.on('message.created', handleMessageCreated);
    socket.on('message.updated', handleMessageUpdated);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    connectionChangeRef.current?.(socket.connected);

    return () => {
      socket.off('conversation.created', handleCreated);
      socket.off('conversation.updated', handleUpdated);
      socket.off('message.created', handleMessageCreated);
      socket.off('message.updated', handleMessageUpdated);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, []);
}
