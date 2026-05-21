import { router, usePathname } from "expo-router";
import { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuthStore, UserRole } from "../stores/auth.store";

type NavItem = {
  label: string;
  path: string;
};

const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  CORRETOR: [
    { label: "Home", path: "/home" },
    { label: "Conversas", path: "/conversas" },
    { label: "Visitas", path: "/visitas" },
    { label: "Perfil", path: "/perfil" },
  ],
  GESTOR: [
    { label: "Home", path: "/home" },
    { label: "Conversas", path: "/conversas" },
    { label: "Corretores", path: "/corretores" },
    { label: "Visitas", path: "/visitas" },
    { label: "Empreendimentos", path: "/empreendimentos" },
    { label: "Perfil", path: "/perfil" },
  ],
  ADM: [
    { label: "Home", path: "/home" },
    { label: "Conversas", path: "/conversas" },
    { label: "Corretores", path: "/corretores" },
    { label: "Gestores", path: "/gestores" },
    { label: "Empreendimentos", path: "/empreendimentos" },
    { label: "Visitas", path: "/visitas" },
    { label: "Templates", path: "/templates" },
    { label: "Configurações", path: "/configuracoes" },
    { label: "Usuários", path: "/usuarios" },
    { label: "Perfil", path: "/perfil" },
  ],
};

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);

  const items = user?.role ? NAV_BY_ROLE[user.role] : [];

  function isActive(path: string) {
    if (path === "/home") return pathname === "/home";
    return pathname === path || pathname.startsWith(`${path}/`);
  }

  return (
    <View style={styles.root}>
      <View style={styles.content}>{children}</View>

      <View style={styles.navWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.navContent}
        >
          {items.map((item) => {
            const active = isActive(item.path);

            return (
              <Pressable
                key={item.path}
                style={[styles.navItem, active ? styles.navItemActive : null]}
                onPress={() => router.replace(item.path as never)}
              >
                <Text style={[styles.navText, active ? styles.navTextActive : null]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  content: {
    flex: 1,
  },
  navWrapper: {
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingVertical: 10,
  },
  navContent: {
    paddingHorizontal: 12,
    gap: 8,
  },
  navItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  navItemActive: {
    backgroundColor: "#0F172A",
    borderColor: "#0F172A",
  },
  navText: {
    color: "#334155",
    fontWeight: "800",
    fontSize: 13,
  },
  navTextActive: {
    color: "#FFFFFF",
  },
});