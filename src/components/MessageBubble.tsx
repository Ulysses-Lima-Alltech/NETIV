import { useState } from 'react';
import type { Message } from '../types';
import { formatMessageTime } from '../utils/format';

interface MessageBubbleProps {
  message: Message;
  onDeleteMessage?: (messageId: string) => void | Promise<void>;
}

export function MessageBubble({ message, onDeleteMessage }: MessageBubbleProps) {
  const isAgent = message.sender === 'AGENT';
  const [hovered, setHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (!onDeleteMessage || deleting) return;
    setDeleting(true);
    try {
      await onDeleteMessage(message.id);
    } finally {
      setDeleting(false);
      setShowDeleteModal(false);
      setShowMenu(false);
    }
  };

  // ── Mensagem apagada — placeholder ──────────────────────────────────────────
  if (message.deleted) {
    return (
      <div className={`flex ${isAgent ? 'justify-end' : 'justify-start'} mb-2.5`}>
        <div
          className={`
            max-w-[75%] rounded-2xl px-4 py-2.5
            ${isAgent
              ? 'bg-[#DBEAFE] border border-[#BFDBFE] rounded-br-md'
              : 'bg-[#F3F4F6] border border-[#E5E7EB] rounded-bl-md'}
          `}
        >
          <p className="text-[13px] italic text-[#9CA3AF] flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
            </svg>
            Esta mensagem foi apagada
          </p>
          <p className={`text-[11px] mt-1 ${isAgent ? 'text-[#93C5FD]' : 'text-[#9CA3AF]'}`}>
            {formatMessageTime(message.createdAt)}
          </p>
        </div>
      </div>
    );
  }

  // ── Mensagem normal ──────────────────────────────────────────────────────────
  return (
    <>
      <div
        className={`flex ${isAgent ? 'justify-end' : 'justify-start'} mb-2.5 group relative`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); if (!showDeleteModal) setShowMenu(false); }}
      >
        {/* Botão "..." — aparece no hover, lado contrário à bolha */}
        {onDeleteMessage && (hovered || showMenu) && (
          <div
            className={`self-center flex-shrink-0 mx-1.5 ${isAgent ? 'order-first' : 'order-last'}`}
          >
            <div className="relative">
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="w-6 h-6 rounded-full flex items-center justify-center text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#374151] transition-colors"
                title="Ações"
                aria-label="Ações da mensagem"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden>
                  <path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
                </svg>
              </button>

              {showMenu && (
                <div
                  className={`absolute z-30 mt-1 w-40 bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1 text-[13px] ${
                    isAgent ? 'right-0' : 'left-0'
                  }`}
                >
                  <button
                    onClick={() => { setShowMenu(false); setShowDeleteModal(true); }}
                    className="w-full text-left px-3 py-2 text-[#EF4444] hover:bg-[#FEF2F2] flex items-center gap-2 transition-colors"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0" aria-hidden>
                      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                    </svg>
                    Excluir mensagem
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bolha principal */}
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

      {/* Modal de confirmação */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => { if (!deleting) setShowDeleteModal(false); }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-[360px] max-w-[calc(100vw-32px)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-[#FEE2E2] flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-[#EF4444]" aria-hidden>
                  <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-[#111827] leading-snug">Excluir mensagem</h3>
                <p className="text-[13px] text-[#6B7280] mt-1.5 leading-relaxed">
                  Isso remove a mensagem apenas do <strong className="text-[#374151]">NETIV</strong>.{' '}
                  A mensagem <strong className="text-[#374151]">não será apagada</strong> do WhatsApp do cliente.
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-5">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="px-4 py-2 text-[13px] font-medium text-[#374151] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="px-4 py-2 text-[13px] font-medium text-white bg-[#EF4444] rounded-lg hover:bg-[#DC2626] transition-colors disabled:opacity-60 flex items-center gap-1.5"
              >
                {deleting && (
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
