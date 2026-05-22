import { router, usePathname } from "expo-router";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthStore, UserRole } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";
import { colors } from "../theme";
import { AppMenu, AppMenuItem } from "./AppMenu";
import { BottomNavigation, BottomNavItem } from "./BottomNavigation";
import { Header } from "./Header";

const BOTTOM_NAV_ITEMS: BottomNavItem[] = [
  { label: "Início", path: "/home", icon: "home-variant-outline" },
  { label: "Conversas", path: "/conversas", icon: "message-text-outline" },
  { label: "Visitas", path: "/visitas", icon: "calendar-month-outline" },
  { label: "Perfil", path: "/perfil", icon: "account-circle-outline" },
];

const TOP_MENU_ITEMS: Record<UserRole, AppMenuItem[]> = {
  CORRETOR: [],
  GESTOR: [],
  ADM: [
    {
      label: "Equipe e usuarios",
      description: "Corretores, gestores e administradores da operacao.",
      path: "/equipe",
      icon: "account-multiple-outline",
    },
    {
      label: "Empreendimentos",
      description: "Gestao dos empreendimentos e responsaveis.",
      path: "/empreendimentos",
      icon: "office-building-outline",
    },
    {
      label: "Templates",
      description: "Modelos de atendimento e fluxos de conversa.",
      path: "/templates",
      icon: "file-document-multiple-outline",
    },
    {
      label: "Configuracoes",
      description: "Parametros administrativos e de operacao.",
      path: "/configuracoes",
      icon: "cog-outline",
    },
  ],
};

const roleLabelByRole: Record<UserRole, string> = {
  CORRETOR: "Corretor",
  GESTOR: "Gestor",
  ADM: "Administrador",
};

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const [menuOpen, setMenuOpen] = useState(false);
  const shouldOpenAdminMenu = useUiStore((state) => state.shouldOpenAdminMenu);
  const consumeAdminMenuRequest = useUiStore((state) => state.consumeAdminMenuRequest);
  const role = user?.role ?? "CORRETOR";

  const menuItems = useMemo(() => TOP_MENU_ITEMS[role], [role]);
  const showMenuButton = role === "ADM" && menuItems.length > 0;

  useEffect(() => {
    if (!shouldOpenAdminMenu) return;

    if (showMenuButton) {
      setMenuOpen(true);
    }

    consumeAdminMenuRequest();
  }, [consumeAdminMenuRequest, shouldOpenAdminMenu, showMenuButton]);

  function navigate(path: string) {
    setMenuOpen(false);
    router.replace(path as never);
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Header
        userName={user?.name ?? "Usuario"}
        role={roleLabelByRole[role]}
        showMenuButton={showMenuButton}
        onOpenMenu={() => setMenuOpen(true)}
      />

      <View style={styles.content}>{children}</View>

      <BottomNavigation items={BOTTOM_NAV_ITEMS} currentPath={pathname} onNavigate={navigate} />

      <AppMenu
        visible={menuOpen}
        roleLabel={roleLabelByRole[role]}
        items={menuItems}
        onClose={() => setMenuOpen(false)}
        onSelectItem={navigate}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
});
