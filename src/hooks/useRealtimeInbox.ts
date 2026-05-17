import { useEffect, useRef } from 'react';
import { getInboxSocket, refreshInboxSocketAuth } from '../realtime/socketClient';

interface UseRealtimeInboxArgs {
  onConversationCreated: (payload: unknown) => void;
  onConversationUpdated: (payload: unknown) => void;
  onMessageCreated: (payload: unknown) => void;
  onMessageUpdated?: (payload: unknown) => void;
}

export function useRealtimeInbox({
  onConversationCreated,
  onConversationUpdated,
  onMessageCreated,
  onMessageUpdated,
}: UseRealtimeInboxArgs): void {
  const createdRef = useRef(onConversationCreated);
  const updatedRef = useRef(onConversationUpdated);
  const messageCreatedRef = useRef(onMessageCreated);
  const messageUpdatedRef = useRef(onMessageUpdated);

  createdRef.current = onConversationCreated;
  updatedRef.current = onConversationUpdated;
  messageCreatedRef.current = onMessageCreated;
  messageUpdatedRef.current = onMessageUpdated;

  useEffect(() => {
    refreshInboxSocketAuth();
    const socket = getInboxSocket();

    const handleCreated = (payload: unknown) => createdRef.current(payload);
    const handleUpdated = (payload: unknown) => updatedRef.current(payload);
    const handleMessageCreated = (payload: unknown) => messageCreatedRef.current(payload);
    const handleMessageUpdated = (payload: unknown) => messageUpdatedRef.current?.(payload);

    socket.on('conversation.created', handleCreated);
    socket.on('conversation.updated', handleUpdated);
    socket.on('message.created', handleMessageCreated);
    socket.on('message.updated', handleMessageUpdated);

    return () => {
      socket.off('conversation.created', handleCreated);
      socket.off('conversation.updated', handleUpdated);
      socket.off('message.created', handleMessageCreated);
      socket.off('message.updated', handleMessageUpdated);
    };
  }, []);
}
