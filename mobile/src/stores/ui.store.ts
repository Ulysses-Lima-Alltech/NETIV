import { create } from "zustand";

type UiState = {
  shouldOpenAdminMenu: boolean;
  requestAdminMenu: () => void;
  consumeAdminMenuRequest: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  shouldOpenAdminMenu: false,
  requestAdminMenu: () => set({ shouldOpenAdminMenu: true }),
  consumeAdminMenuRequest: () => set({ shouldOpenAdminMenu: false }),
}));
