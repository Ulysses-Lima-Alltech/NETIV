import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';

export interface NavItem {
  to: string;
  label: string;
}

export function useAppNav(): NavItem[] {
  const { isAdmin } = useAuth();

  return useMemo(() => {
    const items: NavItem[] = [
      { to: '/inbox', label: 'Inbox' },
      { to: '/dashboard', label: 'Dashboard' },
      { to: '/agenda', label: 'Agenda' },
    ];
    if (isAdmin) {
      items.push({ to: '/settings/empreendimentos', label: 'Empreendimentos' });
      items.push({ to: '/settings/corretores', label: 'Corretores' });
      items.push({ to: '/settings/integrations/whatsapp', label: 'Configurações' });
      items.push({ to: '/users', label: 'Usuários' });
    }
    return items;
  }, [isAdmin]);
}
