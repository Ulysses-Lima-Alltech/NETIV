import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../src/components/AppShell";
import { StatusBadge } from "../src/components/StatusBadge";
import { useAuthStore } from "../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../src/theme";

function getInitials(name?: string) {
  if (!name) return "N";
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export default function ProfileScreen() {
  const user = useAuthStore((state) => state.user);
  const logoutStore = useAuthStore((state) => state.logout);

  function handleLogout() {
    logoutStore();
    router.replace("/login");
  }

  return (
    <AppShell>
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(user?.name)}</Text>
            </View>
            <View style={styles.nameWrap}>
              <Text style={styles.name}>{user?.name ?? "Usuário"}</Text>
              <Text style={styles.username}>@{user?.username ?? "usuario"}</Text>
            </View>
          </View>

          <View style={styles.rows}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Perfil</Text>
              <StatusBadge label={user?.role ?? "-"} tone="info" />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Acesso</Text>
              <Text style={styles.rowValue}>Mobile NETIV</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Permissão</Text>
              <Text style={styles.rowValue}>Operação comercial</Text>
            </View>
          </View>

          <Pressable style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutButtonText}>Sair</Text>
          </Pressable>
        </View>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.strong,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    ...typography.sectionTitle,
    color: "#FFFFFF",
  },
  nameWrap: {
    flex: 1,
  },
  name: {
    ...typography.sectionTitle,
    color: colors.navy,
  },
  username: {
    ...typography.body,
    color: colors.muted,
    marginTop: 2,
  },
  rows: {
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowLabel: {
    ...typography.body,
    color: colors.muted,
  },
  rowValue: {
    ...typography.cardTitle,
    color: colors.text,
  },
  logoutButton: {
    marginTop: spacing.xl,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutButtonText: {
    ...typography.cardTitle,
    color: "#FFFFFF",
  },
});

