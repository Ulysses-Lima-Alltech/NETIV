import type { SessionScope } from '../contexts/AuthContext';

interface ScopeBannerProps {
  sessionScope: SessionScope | null;
}

export function ScopeBanner({ sessionScope }: ScopeBannerProps) {
  if (!sessionScope || sessionScope.scopeKind !== 'broker_portfolio') {
    return null;
  }

  const scopeSize = sessionScope.scopeSize ?? 0;
  const scopeTotal = sessionScope.scopeTotal ?? 0;

  // Se não tem conversas visíveis mas tem total > 0, mostra gap
  if (scopeSize === 0 && scopeTotal > 0) {
    return (
      <div className="mx-4 mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800">
        <span className="font-medium">Aviso:</span> Nenhuma conversa disponível no momento ({scopeTotal} leads na carteira).
      </div>
    );
  }

  // Se tem conversas visíveis, mostra "Mostrando X de Y"
  if (scopeSize > 0 && scopeTotal > scopeSize) {
    return (
      <div className="mx-4 mb-3 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-[12px] text-blue-800">
        Mostrando {scopeSize} de {scopeTotal} conversas da sua carteira.
      </div>
    );
  }

  return null;
}
