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
        {message.attachment && (
          <div
            className={`mb-2 inline-flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium ${
              isAgent ? 'bg-white/15 text-white' : 'bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]'
            }`}
          >
            <span aria-hidden>📎</span>
            <span className="break-all">
              {message.messageType === 'image' ? 'Imagem: ' : 'Arquivo: '}
              {message.attachment.fileName}
            </span>
            {message.attachment.sizeBytes != null && (
              <span className={isAgent ? 'opacity-75' : 'text-[#64748B]'}>
                ({(message.attachment.sizeBytes / 1024).toFixed(0)} KB)
              </span>
            )}
          </div>
        )}
        <p className="text-[14px] whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>
        <p className={`text-[11px] mt-1.5 ${isAgent ? 'text-white/60' : 'text-[#9CA3AF]'}`}>
          {formatMessageTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}
