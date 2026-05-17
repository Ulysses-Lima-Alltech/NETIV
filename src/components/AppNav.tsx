import { useAuth } from '../contexts/AuthContext';

export function AppNav() {
  const { user } = useAuth();
  const isDev = import.meta.env.DEV;

  if (!user) return null;

  const displayName = !isDev && /bypass/i.test(user.name) ? '' : user.name;
  if (!displayName) return null;

  return (
    <div className="inline-flex items-center gap-2 rounded-[12px] border border-[#e2e8f0] bg-white px-3 py-1.5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
      <span className="truncate text-[12px] font-medium text-[#334155]" title={displayName}>
        {displayName}
      </span>
    </div>
  );
}

