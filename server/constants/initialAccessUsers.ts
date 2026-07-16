import type { UserRole } from './roles.js';

export interface InitialAccessUserDefinition {
  username: string;
  name: string;
  role: UserRole;
  managerUsername?: string;
}

export const INITIAL_ACCESS_USERS: readonly InitialAccessUserDefinition[] = [
  { username: 'ulysses', name: 'Ulysses', role: 'ADMIN' },
  { username: 'emerson', name: 'Emerson', role: 'ADMIN' },
  { username: 'pedro', name: 'Pedro', role: 'ADMIN' },
  { username: 'lucas.pimenta', name: 'Lucas Pimenta', role: 'MANAGERIAL' },
  { username: 'kaua.sdr', name: 'Kaua SDR', role: 'COLLABORATOR', managerUsername: 'lucas.pimenta' },
  { username: 'georgia.sdr', name: 'Georgia SDR', role: 'COLLABORATOR', managerUsername: 'lucas.pimenta' },
  { username: 'rafael.sdr', name: 'Rafael SDR', role: 'COLLABORATOR', managerUsername: 'lucas.pimenta' },
] as const;
