import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isNavItemActive, useAppNav } from '../../hooks/useAppNav';
import { SidebarIcon } from './SidebarIcons';
import anaAvatar from '../../assets/ana-avatar.svg';

interface SidebarNavProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onRequestCloseMobile: () => void;
}

export function SidebarNav({ collapsed, onToggleCollapsed, mobileOpen, onRequestCloseMobile }: SidebarNavProps) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const items = useAppNav();
  const isDev = import.meta.env.DEV;

  const mainItems = items.filter((item) => item.section === 'main');
  const footerItems = items.filter((item) => item.section === 'footer');

  const profileName = user
    ? !isDev && /bypass/i.test(user.name)
      ? ''
      : user.name
    : '';

  return (
    <aside
      className={`netiv-sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}
      aria-label="Menu principal"
    >
      <div className="netiv-sidebar__brand">
        <img src={anaAvatar} alt="Ana" className="netiv-brand-mark" />
        <div className="netiv-collapsible-text min-w-0">
          <strong className="block text-[15px] font-semibold tracking-[0.01em]">NETIV</strong>
          <span className="block mt-0.5 text-[12px] text-white/65">Central comercial</span>
        </div>
      </div>

      <nav className="netiv-sidebar__nav">
        {mainItems.map((item) => {
          const active = isNavItemActive(pathname, item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onRequestCloseMobile}
              className={`netiv-sidebar__item ${active ? 'is-active' : ''}`}
            >
              <span className="netiv-sidebar__icon">
                <SidebarIcon name={item.icon} />
              </span>
              <span className="netiv-collapsible-text truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="netiv-sidebar__footer">
        {footerItems.map((item) => {
          const active = isNavItemActive(pathname, item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onRequestCloseMobile}
              className={`netiv-sidebar__item ${active ? 'is-active' : ''}`}
            >
              <span className="netiv-sidebar__icon">
                <SidebarIcon name={item.icon} />
              </span>
              <span className="netiv-collapsible-text truncate">{item.label}</span>
            </Link>
          );
        })}

        {user && profileName && (
          <div className="netiv-sidebar__profile netiv-collapsible-text" title={profileName}>
            {profileName}
          </div>
        )}

        {user && (
          <button type="button" onClick={() => logout()} className="netiv-sidebar__item">
            <span className="netiv-sidebar__icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" className="h-[19px] w-[19px]">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M16 17l5-5-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="netiv-collapsible-text">Sair</span>
          </button>
        )}

        <button
          type="button"
          onClick={onToggleCollapsed}
          className="netiv-sidebar__collapse"
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
            {collapsed ? (
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
      </div>
    </aside>
  );
}
