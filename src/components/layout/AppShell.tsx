import { useEffect, useState } from 'react';
import { SidebarNav } from './SidebarNav';

const SIDEBAR_COLLAPSED_KEY = 'netiv_sidebar_collapsed_v1';

function getStoredCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => getStoredCollapsed());
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // noop
    }
  }, [collapsed]);

  return (
    <div className={`netiv-app-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <SidebarNav
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((prev) => !prev)}
        mobileOpen={mobileOpen}
        onRequestCloseMobile={() => setMobileOpen(false)}
      />

      <main className="netiv-app-main">
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="netiv-mobile-menu-btn"
          aria-label={mobileOpen ? 'Fechar menu principal' : 'Abrir menu principal'}
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden>
            {mobileOpen ? (
              <>
                <path d="M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </>
            ) : (
              <>
                <path d="M3 7h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M3 12h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M3 17h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </>
            )}
          </svg>
        </button>

        {mobileOpen && (
          <button
            type="button"
            className="netiv-mobile-backdrop"
            aria-hidden
            onClick={() => setMobileOpen(false)}
          />
        )}

        {children}
      </main>
    </div>
  );
}
