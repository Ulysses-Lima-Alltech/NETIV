import { router, usePathname } from "expo-router";
import { ReactNode, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { brand, colors } from "../theme/brand";
import { useAuthStore, UserRole } from "../stores/auth.store";

type NavItem = {
  label: string;
  path: string;
  icon: string;
};

type MenuItem = {
  label: string;
  description: string;
  path: string;
  icon: string;
};

const PRIMARY_NAV: NavItem[] = [
  { label: "Início", path: "/home", icon: "🏠" },
  { label: "Conversas", path: "/conversas", icon: "💬" },
  { label: "Visitas", path: "/visitas", icon: "📅" },
  { label: "Perfil", path: "/perfil", icon: "👤" },
];

const EXTRA_NAV_BY_ROLE: Record<UserRole, MenuItem[]> = {
  CORRETOR: [],
  GESTOR: [
    {
      label: "Equipe",
      description: "Corretores vinculados aos seus empreendimentos.",
      path: "/equipe",
      icon: "👥",
    },
    {
      label: "Empreendimentos",
      description: "Empreendimentos sob sua responsabilidade.",
      path: "/empreendimentos",
      icon: "🏢",
    },
  ],
  ADM: [
    {
      label: "Equipe e usuários",
      description: "Corretores, gestores e acessos administrativos.",
      path: "/equipe",
      icon: "👥",
    },
    {
      label: "Empreendimentos",
      description: "Gestão dos empreendimentos da operação.",
      path: "/empreendimentos",
      icon: "🏢",
    },
    {
      label: "Templates",
      description: "Modelos de mensagens e respostas.",
      path: "/templates",
      icon: "📄",
    },
    {
      label: "Configurações",
      description: "Ajustes administrativos do aplicativo.",
      path: "/configuracoes",
      icon: "⚙",
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

  const extraItems = user?.role ? EXTRA_NAV_BY_ROLE[user.role] : [];

  function isActive(path: string) {
    if (path === "/home") return pathname === "/home";
    return pathname === path || pathname.startsWith(`${path}/`);
  }

  function goTo(path: string) {
    setMenuOpen(false);
    router.replace(path as never);
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={styles.brandBlock}>
          <Text style={styles.brand}>{brand.name}</Text>
          <Text style={styles.roleText}>
            {user?.name ?? "Usuário"} • {user?.role ?? "SEM PERFIL"}
          </Text>
        </View>

        {extraItems.length > 0 ? (
          <Pressable style={styles.menuButton} onPress={() => setMenuOpen(true)}>
            <Text style={styles.menuButtonIcon}>▦</Text>
            <Text style={styles.menuButtonText}>Menu</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.content}>{children}</View>

      <View style={styles.bottomNavOuter}>
        <View style={styles.bottomNav}>
          {PRIMARY_NAV.map((item) => {
            const active = isActive(item.path);

            return (
              <Pressable
                key={item.path}
                style={[styles.bottomNavItem, active ? styles.bottomNavItemActive : null]}
                onPress={() => goTo(item.path)}
              >
                <Text style={[styles.navIcon, active ? styles.navIconActive : null]}>
                  {item.icon}
                </Text>

                <Text style={[styles.navText, active ? styles.navTextActive : null]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.menuPanel}>
            <View style={styles.menuHandle} />

            <Text style={styles.menuTitle}>Menu</Text>
            <Text style={styles.menuSubtitle}>
              Acessos disponíveis para {user?.role ?? "usuário"}
            </Text>

            <ScrollView contentContainerStyle={styles.menuList}>
              {extraItems.map((item) => (
                <Pressable
                  key={item.path}
                  style={styles.menuItem}
                  onPress={() => goTo(item.path)}
                >
                  <View style={styles.menuIconBox}>
                    <Text style={styles.menuIcon}>{item.icon}</Text>
                  </View>

                  <View style={styles.menuItemTextBlock}>
                    <Text style={styles.menuItemText}>{item.label}</Text>
                    <Text style={styles.menuItemDescription}>{item.description}</Text>
                  </View>

                  <Text style={styles.menuArrow}>›</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Pressable style={styles.closeButton} onPress={() => setMenuOpen(false)}>
              <Text style={styles.closeButtonText}>Fechar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.navy,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandBlock: {
    flex: 1,
    paddingRight: 12,
  },
  brand: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  roleText: {
    color: "#CBD5E1",
    fontSize: 12,
    marginTop: 3,
  },
  menuButton: {
    backgroundColor: colors.orange,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  menuButtonIcon: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  menuButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 14,
  },
  content: {
    flex: 1,
  },
  bottomNavOuter: {
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  bottomNav: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 5,
  },
  bottomNavItem: {
    flex: 1,
    minHeight: 62,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  bottomNavItemActive: {
    backgroundColor: colors.navy,
  },
  navIcon: {
    fontSize: 21,
    lineHeight: 24,
    color: colors.muted,
    fontWeight: "900",
  },
  navIconActive: {
    color: "#FFFFFF",
  },
  navText: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.muted,
  },
  navTextActive: {
    color: "#FFFFFF",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(6, 29, 51, 0.55)",
    justifyContent: "flex-end",
  },
  menuPanel: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    maxHeight: "78%",
  },
  menuHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 99,
    backgroundColor: "#CBD5E1",
    marginBottom: 14,
  },
  menuTitle: {
    fontSize: 26,
    fontWeight: "900",
    color: colors.navy,
  },
  menuSubtitle: {
    color: colors.muted,
    marginTop: 4,
    marginBottom: 16,
  },
  menuList: {
    gap: 10,
  },
  menuItem: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  menuIconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  menuIcon: {
    fontSize: 20,
  },
  menuItemTextBlock: {
    flex: 1,
  },
  menuItemText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  menuItemDescription: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  menuArrow: {
    color: colors.orange,
    fontSize: 28,
    fontWeight: "900",
  },
  closeButton: {
    backgroundColor: colors.navy,
    borderRadius: 16,
    paddingVertical: 14,
    marginTop: 18,
  },
  closeButtonText: {
    color: "#FFFFFF",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 16,
  },
});