import { Link, useLocation } from 'react-router-dom';

const navBtnBase = 'px-4 py-2 rounded-[10px] text-[13px] font-medium text-white transition-all duration-200';
const navBtnDefault = 'bg-[#60A5FA] hover:bg-[#F97316]';
const navBtnActive = 'bg-[#F97316]';

function isActive(pathname: string, to: string): boolean {
  if (to === '/inbox') return pathname === '/inbox' || pathname === '/';
  if (to === '/dashboard') return pathname === '/dashboard';
  if (to === '/settings/empreendimentos') return pathname.startsWith('/settings/empreendimentos');
  if (to === '/settings/corretores') return pathname.startsWith('/settings/corretores');
  if (to === '/settings/integrations/whatsapp') return pathname.startsWith('/settings/integrations');
  if (to === '/agenda') return pathname.startsWith('/agenda');
  return pathname === to;
}

export function NavLinkButton({ to, children }: { to: string; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const active = isActive(pathname, to);
  return (
    <Link
      to={to}
      className={`${navBtnBase} ${active ? navBtnActive : navBtnDefault}`}
    >
      {children}
    </Link>
  );
}

export function NavGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 p-1.5 rounded-[12px] bg-[#F3F4F6]/60 border border-[#E5E7EB]">
      {children}
    </div>
  );
}
