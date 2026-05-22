import { router, usePathname } from "expo-router";
import { ReactNode, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthStore, UserRole } from "../stores/auth.store";
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
      label: "Equipe e usuários",
      description: "Corretores, gestores e administradores da operação.",
      path: "/equipe",
      icon: "account-multiple-outline",
    },
    {
      label: "Empreendimentos",
      description: "Gestão dos empreendimentos e responsáveis.",
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
      label: "Configurações",
      description: "Parâmetros administrativos e de operação.",
      path: "/configuracoes",
      icon: "cog-outline",
    },
  ],
};

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const [menuOpen, setMenuOpen] = useState(false);
  const role = user?.role ?? "CORRETOR";

  const menuItems = useMemo(() => TOP_MENU_ITEMS[role], [role]);
  const showMenuButton = menuItems.length > 0;

  function navigate(path: string) {
    setMenuOpen(false);
    router.replace(path as never);
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Header
        userName={user?.name ?? "Usuário"}
        role={role}
        showMenuButton={showMenuButton}
        onOpenMenu={() => setMenuOpen(true)}
      />

      <View style={styles.content}>{children}</View>

      <BottomNavigation items={BOTTOM_NAV_ITEMS} currentPath={pathname} onNavigate={navigate} />

      <AppMenu
        visible={menuOpen}
        roleLabel={role}
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

