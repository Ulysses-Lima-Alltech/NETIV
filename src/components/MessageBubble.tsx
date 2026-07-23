import { useState } from 'react';
import type { Message } from '../types';
import { useEffect } from 'react';
import { formatMessageTime } from '../utils/format';
import { fetchAuthenticatedBlob } from '../api/client';

interface MessageBubbleProps {
  message: Message;
  onDeleteMessage?: (messageId: string) => void | Promise<void>;
  isLast?: boolean;
}

function SecureAttachment({ message, isAgent }: { message: Message; isAgent: boolean }) {
  const attachment = message.attachment;
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const canPreview = message.messageType === 'image' || message.messageType === 'video';

  useEffect(() => {
    if (!attachment?.downloadUrl || !canPreview) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    void fetchAuthenticatedBlob(attachment.downloadUrl)
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachment?.downloadUrl, canPreview]);

  if (!attachment) return null;

  const download = async () => {
    if (!attachment.downloadUrl || downloading) return;
    setDownloading(true);
    try {
      const blob = await fetchAuthenticatedBlob(attachment.downloadUrl);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.fileName || 'arquivo';
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mb-2 space-y-1.5">
      {objectUrl && message.messageType === 'image' && (
        <img src={objectUrl} alt={attachment.fileName || 'Imagem do template'} className="max-h-72 w-full rounded-xl object-contain" />
      )}
      {objectUrl && message.messageType === 'video' && (
        <video src={objectUrl} controls className="max-h-72 w-full rounded-xl" aria-label={attachment.fileName || 'Vídeo do template'} />
      )}
      <button
        type="button"
        onClick={() => void download()}
        disabled={!attachment.downloadUrl || downloading}
        className={`inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium ${isAgent ? 'bg-white/15 text-white' : 'border border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'} disabled:cursor-default`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span className="break-all">
          {message.messageType === 'image' ? 'Imagem: ' : message.messageType === 'video' ? 'Vídeo: ' : 'Arquivo: '}
          {attachment.fileName}
        </span>
        {attachment.sizeBytes != null && (
          <span className={isAgent ? 'opacity-75' : 'text-[#64748b]'}>
            ({(attachment.sizeBytes / 1024).toFixed(0)} KB)
          </span>
        )}
      </button>
      {loadError && <p className="text-[11px] opacity-75">Prévia indisponível; os metadados do arquivo foram preservados.</p>}
      {attachment.caption && attachment.caption !== message.text && (
        <p className="whitespace-pre-wrap text-[12px] opacity-90">{attachment.caption}</p>
      )}
    </div>
  );
}

function deliveryLabel(message: Message): string {
  if (message.status === 'failed') return 'Falha no envio';
  if (message.status === 'read') return 'Lida';
  if (message.status === 'delivered') return 'Entregue';
  if (message.status === 'pending') return 'Pendente';
  if (message.status === 'accepted') return 'Aceita';
  return 'Enviada';
}

export function MessageBubble({ message, onDeleteMessage, isLast = false }: MessageBubbleProps) {
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

  if (message.deleted) {
    return (
      <div className={`mb-2.5 flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`max-w-[76%] rounded-[18px] px-4 py-2.5 ${isAgent ? 'rounded-br-[8px] border border-[#bfdbfe] bg-[#dbeafe]' : 'rounded-bl-[8px] border border-[#e2e8f0] bg-[#f1f5f9]'}`}
        >
          <p className="flex items-center gap-1.5 text-[13px] italic text-[#94a3b8]">
            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
            </svg>
            Esta mensagem foi apagada
          </p>
          <p className="mt-1 text-[11px] text-[#94a3b8]">{formatMessageTime(message.createdAt)}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={`group relative flex ${isAgent ? 'justify-end' : 'justify-start'} ${isLast ? 'mb-0' : 'mb-2.5'}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setHovered(false);
          if (!showDeleteModal) setShowMenu(false);
        }}
      >
        {onDeleteMessage && (hovered || showMenu) && (
          <div className={`mx-1.5 self-center ${isAgent ? 'order-first' : 'order-last'} flex-shrink-0`}>
            <div className="relative">
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#334155]"
                title="Acoes"
                aria-label="Acoes da mensagem"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                  <path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
                </svg>
              </button>

              {showMenu && (
                <div className={`absolute z-30 mt-1 w-40 rounded-lg border border-[#e2e8f0] bg-white py-1 text-[13px] shadow-lg ${isAgent ? 'right-0' : 'left-0'}`}>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowDeleteModal(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[#ef4444] transition-colors hover:bg-[#fef2f2]"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" aria-hidden>
                      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                    </svg>
                    Excluir mensagem
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div
          className={`max-w-[76%] rounded-[18px] px-4 py-2.5 text-[14px] shadow-[0_8px_24px_rgba(15,23,42,0.07)] ${isAgent ? 'rounded-br-[8px] bg-[linear-gradient(135deg,#2563eb,#3478f6)] text-white' : 'rounded-bl-[8px] border border-[#e2e8f0] bg-white text-[#1e293b]'}`}
        >
          <SecureAttachment message={message} isAgent={isAgent} />

          <p className="whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>
          {message.template?.buttons && message.template.buttons.length > 0 && (
            <div className="mt-2 space-y-1.5 border-t border-current/15 pt-2">
              {message.template.buttons.map((button, index) =>
                button.type === 'url' && button.url ? (
                  <a
                    key={`${button.text}-${index}`}
                    href={button.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={`block rounded-lg px-3 py-1.5 text-center text-[12px] font-semibold underline ${isAgent ? 'bg-white/15 text-white' : 'bg-[#eff6ff] text-[#1d4ed8]'}`}
                  >
                    {button.text || button.url}
                    <span className="mt-0.5 block break-all text-[10px] font-normal opacity-75">{button.url}</span>
                  </a>
                ) : (
                  <div key={`${button.text}-${index}`} className={`rounded-lg px-3 py-1.5 text-center text-[12px] font-semibold ${isAgent ? 'bg-white/15' : 'bg-[#eff6ff] text-[#1d4ed8]'}`}>
                    {button.text || button.payload || 'Resposta rápida'}
                  </div>
                )
              )}
            </div>
          )}
          {message.status === 'failed' && (
            <p className={`mt-2 rounded-md px-2 py-1 text-[11px] ${isAgent ? 'bg-red-950/25 text-red-50' : 'bg-red-50 text-red-700'}`}>
              {message.failure?.message || 'A Meta informou que esta mensagem falhou.'}
              {message.failure?.code != null ? ` (código ${message.failure.code})` : ''}
            </p>
          )}
          <p className={`mt-1.5 text-[10px] font-medium ${isAgent ? 'text-white/70' : 'text-[#94a3b8]'}`}>
            {formatMessageTime(message.createdAt)}{isAgent ? ` ? ${deliveryLabel(message)}` : ''}
          </p>
        </div>
      </div>

      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => {
            if (!deleting) setShowDeleteModal(false);
          }}
        >
          <div className="w-[360px] max-w-[calc(100vw-32px)] rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#fee2e2]">
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-[#ef4444]" aria-hidden>
                  <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h3 className="text-[15px] font-semibold leading-snug text-[#111827]">Excluir mensagem</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#64748b]">
                  Isso remove a mensagem apenas do <strong className="text-[#334155]">NETIV</strong>. A mensagem nao sera apagada do WhatsApp do cliente.
                </p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2 text-[13px] font-medium text-[#334155] transition-colors hover:bg-[#f8fafc] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-lg bg-[#ef4444] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#dc2626] disabled:opacity-60"
              >
                {deleting && (
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
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
