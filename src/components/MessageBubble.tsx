import type { Message } from '../types';
import { formatMessageTime } from '../utils/format';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isAgent = message.sender === 'AGENT';

  return (
    <div className={`flex ${isAgent ? 'justify-end' : 'justify-start'} mb-2.5`}>
      <div
        className={`
          max-w-[75%] rounded-2xl px-4 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.06)]
          ${isAgent
            ? 'bg-[#3B82F6] text-white rounded-br-md'
            : 'bg-white text-[#111827] border border-[#E5E7EB] rounded-bl-md'}
        `}
      >
        <p className="text-[14px] whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>
        <p className={`text-[11px] mt-1.5 ${isAgent ? 'text-white/60' : 'text-[#9CA3AF]'}`}>
          {formatMessageTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}
