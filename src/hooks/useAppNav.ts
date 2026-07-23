import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';

export type SidebarIconName =
  | 'inbox'
  | 'dashboard'
  | 'agenda'
  | 'empreendimentos'
  | 'corretores'
  | 'users'
  | 'contatos'
  | 'batch'
  | 'settings'
  | 'lab';

export type NavSection = 'main' | 'footer';

export interface NavItem {
  to: string;
  label: string;
  icon: SidebarIconName;
  section: NavSection;
}

export function isNavItemActive(pathname: string, to: string): boolean {
  if (to === '/inbox') return pathname === '/inbox' || pathname === '/';
  if (to === '/dashboard') return pathname.startsWith('/dashboard');
  if (to === '/agenda') return pathname.startsWith('/agenda');
  if (to === '/settings/empreendimentos') return pathname.startsWith('/settings/empreendimentos');
  if (to === '/settings/corretores') return pathname.startsWith('/settings/corretores');
  if (to === '/users') return pathname.startsWith('/users');
  if (to === '/contatos') return pathname.startsWith('/contatos') && !pathname.startsWith('/contatos/disparo-template-lote');
  if (to === '/contatos/disparo-template-lote') return pathname.startsWith('/contatos/disparo-template-lote');
  if (to === '/settings/integrations/whatsapp') return pathname.startsWith('/settings/integrations/whatsapp');
  if (to === '/lead-simulator') return pathname.startsWith('/lead-simulator');
  return pathname === to;
}

export function useAppNav(): NavItem[] {
  const { hasElevatedAccess, isAdmin } = useAuth();
  const isDev = import.meta.env.DEV;

  return useMemo(() => {
    const items: NavItem[] = [
      { to: '/inbox', label: 'Inbox', icon: 'inbox', section: 'main' },
      { to: '/dashboard', label: 'Dashboard', icon: 'dashboard', section: 'main' },
      { to: '/agenda', label: 'Agenda', icon: 'agenda', section: 'main' },
    ];

    if (hasElevatedAccess) {
      items.push({ to: '/settings/empreendimentos', label: 'Empreendimentos', icon: 'empreendimentos', section: 'main' });
      items.push({ to: '/settings/corretores', label: 'Corretores', icon: 'corretores', section: 'main' });
      items.push({ to: '/users', label: 'Acessos', icon: 'users', section: 'main' });
    }

    items.push({ to: '/contatos', label: 'Leads', icon: 'contatos', section: 'main' });

    if (isAdmin) {
      items.push({ to: '/contatos/disparo-template-lote', label: 'Disparo em lote', icon: 'batch', section: 'main' });
      items.push({ to: '/settings/integrations/whatsapp', label: 'Configuracoes', icon: 'settings', section: 'footer' });
    }

    if (isDev) {
      items.push({ to: '/lead-simulator', label: 'Simulador (dev)', icon: 'lab', section: 'footer' });
    }

    return items;
  }, [hasElevatedAccess, isAdmin, isDev]);
}
