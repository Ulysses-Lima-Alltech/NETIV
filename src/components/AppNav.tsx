import { Link, useLocation } from 'react-router-dom';
import { useAppNav } from '../hooks/useAppNav';
import { useAuth } from '../contexts/AuthContext';

function isActive(pathname: string, to: string): boolean {
  if (to === '/inbox') return pathname === '/inbox' || pathname === '/';
  if (to === '/dashboard') return pathname === '/dashboard';
  if (to === '/settings/empreendimentos') return pathname.startsWith('/settings/empreendimentos');
  if (to === '/settings/corretores') return pathname.startsWith('/settings/corretores');
  if (to === '/settings/integrations/whatsapp') return pathname.startsWith('/settings/integrations');
  if (to === '/contatos') return pathname.startsWith('/contatos');
  if (to === '/agenda') return pathname.startsWith('/agenda');
  if (to === '/users') return pathname.startsWith('/users');
  return pathname === to;
}

const navBtnBase = 'inline-flex items-center px-4 py-2 rounded-[10px] text-[13px] font-medium text-white transition-all duration-200';
const navBtnDefault = 'bg-[#60A5FA] hover:bg-[#F97316]';
const navBtnActive = 'bg-[#F97316]';

export function AppNav() {
  const { pathname } = useLocation();
  const items = useAppNav();
  const { user, logout } = useAuth();

  return (
    <div className="flex items-center gap-2 p-1.5 rounded-[12px] bg-[#F3F4F6]/60 border border-[#E5E7EB]/80">
      {items.map(({ to, label }) => {
        const active = isActive(pathname, to);
        return (
          <Link
            key={to}
            to={to}
            className={`${navBtnBase} ${active ? navBtnActive : navBtnDefault}`}
          >
            {label}
          </Link>
        );
      })}
      {user && (
        <span className="text-[12px] text-[#6B7280] ml-1 px-2 py-1 border-l border-[#E5E7EB]">
          {user.name}
        </span>
      )}
      {user && (
        <button
          type="button"
          onClick={() => logout()}
          className="inline-flex items-center px-3 py-1.5 rounded-[8px] text-[12px] font-medium text-[#6B7280] hover:bg-[#E5E7EB] hover:text-[#111827] transition-colors"
        >
          Sair
        </button>
      )}
    </div>
  );
}
