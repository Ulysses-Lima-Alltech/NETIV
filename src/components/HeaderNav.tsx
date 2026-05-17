import { Link, useLocation } from 'react-router-dom';
import { isNavItemActive } from '../hooks/useAppNav';

const navBtnBase =
  'inline-flex items-center rounded-[12px] px-3 py-2 text-[13px] font-medium transition-colors duration-150';
const navBtnDefault = 'border border-[#e2e8f0] bg-white text-[#334155] hover:border-[#cbd5e1] hover:bg-[#f8fafc]';
const navBtnActive = 'bg-[#f97316] text-white shadow-[0_10px_24px_rgba(249,115,22,0.24)]';

export function NavLinkButton({ to, children }: { to: string; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const active = isNavItemActive(pathname, to);

  return (
    <Link to={to} className={`${navBtnBase} ${active ? navBtnActive : navBtnDefault}`}>
      {children}
    </Link>
  );
}

export function NavGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-[14px] border border-[#e2e8f0] bg-white/85 p-1.5 shadow-[0_8px_20px_rgba(15,23,42,0.05)]">
      {children}
    </div>
  );
}
