// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageBubble } from '../components/MessageBubble';
import type { Message } from '../types';

afterEach(cleanup);

function baseMessage(): Message {
  return {
    id: '10',
    conversationId: '20',
    sender: 'AGENT',
    text: 'Olá, Maria José!\n*É HOJE!* 🏡',
    createdAt: '2026-07-18T12:00:00.000Z',
    messageType: 'image',
    status: 'delivered',
    attachment: {
      fileName: 'convite.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      templateMediaSettingId: 7,
      mediaType: 'image',
      downloadUrl: null,
    },
    template: {
      messageType: 'template',
      templateName: 'convite_evora',
      templateId: 'meta-1',
      templateLanguage: 'pt_BR',
      category: 'MARKETING',
      bodyOriginal: 'Olá, {{1}}!\n*É HOJE!* 🏡',
      parameters: [{ position: 1, value: 'Maria José' }],
      renderedText: 'Olá, Maria José!\n*É HOJE!* 🏡',
      header: { type: 'image', text: null, media: null },
      buttons: [
        { type: 'url', text: 'Como chegar', url: 'https://example.test/mapa', payload: null },
        { type: 'quick_reply', text: 'Confirmar', url: null, payload: 'Confirmar' },
      ],
    },
  };
}

describe('MessageBubble de template', () => {
  it('mostra texto completo, mídia, botões/URL e status na mesma bolha', () => {
    render(<MessageBubble message={baseMessage()} />);
    expect(screen.getByText(/Olá, Maria José!/)).toBeTruthy();
    expect(screen.getByText(/Imagem: convite.jpg/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Como chegar/ }).getAttribute('href')).toBe('https://example.test/mapa');
    expect(screen.getByText('Confirmar')).toBeTruthy();
    expect(screen.getByText(/Entregue/)).toBeTruthy();
  });

  it('exibe falha da Meta sem marcar a mensagem como entregue', () => {
    const message = baseMessage();
    message.status = 'failed';
    message.failure = { code: 131049, title: 'Delivery failed', message: 'Mensagem não entregue.' };
    render(<MessageBubble message={message} />);
    expect(screen.getByText(/Mensagem não entregue.*131049/)).toBeTruthy();
    expect(screen.getByText(/Falha no envio/)).toBeTruthy();
    expect(screen.queryByText(/Entregue/)).toBeNull();
  });

  it('mantém compatibilidade com mensagem legada sem metadata de template', () => {
    render(
      <MessageBubble
        message={{
          id: 'legacy',
          conversationId: '20',
          sender: 'AGENT',
          text: 'Variável 1: Maria José',
          createdAt: '2026-07-18T12:00:00.000Z',
        }}
      />
    );
    expect(screen.getByText('Variável 1: Maria José')).toBeTruthy();
  });
});
