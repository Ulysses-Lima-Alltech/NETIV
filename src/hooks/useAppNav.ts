import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';

export interface NavItem {
  to: string;
  label: string;
}

export function useAppNav(): NavItem[] {
  const { hasElevatedAccess, isAdmin } = useAuth();

  return useMemo(() => {
    const items: NavItem[] = [
      { to: '/inbox', label: 'Inbox' },
      { to: '/dashboard', label: 'Dashboard' },
      { to: '/agenda', label: 'Agenda' },
    ];
    if (hasElevatedAccess) {
      items.push({ to: '/settings/empreendimentos', label: 'Empreendimentos' });
      items.push({ to: '/settings/corretores', label: 'Corretores' });
      items.push({ to: '/users', label: 'Usuários' });
    }
    if (isAdmin) {
      items.push({ to: '/contatos', label: 'Contatos' });
      items.push({ to: '/settings/integrations/whatsapp', label: 'Configurações' });
    }
    return items;
  }, [hasElevatedAccess, isAdmin]);
}
