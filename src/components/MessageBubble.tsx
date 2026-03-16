import type { Message } from '../types';
import { formatMessageTime } from '../utils/format';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isAgent = message.sender === 'AGENT';

  return (
    <div className={`flex ${isAgent ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`
          max-w-[80%] rounded-2xl px-4 py-2.5
          ${isAgent
            ? 'bg-blue-500 text-white rounded-br-md'
            : 'bg-gray-100 text-gray-900 rounded-bl-md'}
        `}
      >
        <p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>
        <p className={`text-xs mt-1 ${isAgent ? 'text-blue-100' : 'text-gray-500'}`}>
          {formatMessageTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}
