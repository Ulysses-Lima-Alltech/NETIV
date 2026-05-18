import { useMemo } from 'react';

interface ContactAvatarProps {
  name: string;
  className?: string;
  textClassName?: string;
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

export function ContactAvatar({
  name,
  className = 'h-10 w-10 rounded-full',
  textClassName = 'text-[12px] font-semibold',
}: ContactAvatarProps) {
  const initials = useMemo(() => getInitials(name), [name]);

  return (
    <div
      className={`${className} shrink-0 bg-[#e2e8f0] text-[#334155] grid place-items-center select-none`}
      aria-label={`Avatar de ${name}`}
    >
      <span className={textClassName}>{initials}</span>
    </div>
  );
}
