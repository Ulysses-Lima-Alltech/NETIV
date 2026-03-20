import type { LeadTemperatura } from '../types';

const temperaturaColors: Record<LeadTemperatura, string> = {
  quente: 'text-[#c72222]', // red ~650 (entre 600 e 700)
  morno: 'text-amber-500',  // âmbar/amarelado, bem distinto do vermelho
  frio: 'text-blue-600',    // azul frio, contrastante
};

interface FlameIconProps {
  temperatura: LeadTemperatura | null;
  className?: string;
  size?: 'sm' | 'md';
}

export function FlameIcon({ temperatura, className = '', size = 'sm' }: FlameIconProps) {
  const colorClass = temperatura == null ? 'text-[#D1D5DB]' : temperaturaColors[temperatura];
  const dim = size === 'sm' ? 14 : 18;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width={dim}
      height={dim}
      className={`shrink-0 ${colorClass} ${className}`}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M12.963 2.286a.75.75 0 0 0-1.071-.136 9.742 9.742 0 0 0-3.539 6.177 7.547 7.547 0 0 1-1.705-1.715.75.75 0 0 0-1.152-.082A9 9 0 1 0 15.68 4.534a7.46 7.46 0 0 1-2.717-2.248ZM15.75 14.25a3.75 3.75 0 1 1-7.313-1.172c.628.465 1.35.81 2.103 1.085C10.5 13.5 10.5 12.75 10.5 12a.75.75 0 0 1 1.5 0c0 .75 0 1.5.563 2.413.252.376.563.727.937 1.043a3.75 3.75 0 0 1 3.25 1.544Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
