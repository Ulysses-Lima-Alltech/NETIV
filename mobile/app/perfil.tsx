import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../src/components/AppShell";
import { ProfileAvatar } from "../src/components/ProfileAvatar";
import { StatusBadge } from "../src/components/StatusBadge";
import { useAuthStore } from "../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../src/theme";

const profileLabelByRole = {
  CORRETOR: "Corretor",
  GESTOR: "Gestor",
  ADM: "Administrador",
} as const;

export default function ProfileScreen() {
  const user = useAuthStore((state) => state.user);
  const logoutStore = useAuthStore((state) => state.logout);
  const role = user?.role ?? "CORRETOR";

  function handleLogout() {
    logoutStore();
    router.replace("/login");
  }

  return (
    <AppShell>
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.header}>
            <ProfileAvatar name={user?.name} size={64} />
            <View style={styles.nameWrap}>
              <Text style={styles.name}>{user?.name ?? "Usuario"}</Text>
              <Text style={styles.username}>@{user?.username ?? "usuario"}</Text>
            </View>
          </View>

          <View style={styles.rows}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Nome</Text>
              <Text style={styles.rowValue}>{user?.name ?? "Usuario"}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.rowLabel}>Usuario</Text>
              <Text style={styles.rowValue}>@{user?.username ?? "usuario"}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.rowLabel}>Perfil</Text>
              <StatusBadge label={profileLabelByRole[role]} tone="info" />
            </View>

            <View style={styles.row}>
              <Text style={styles.rowLabel}>Acesso</Text>
              <StatusBadge label="NETIV Mobile" tone="inverse" />
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
    ...shadows.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  nameWrap: {
    flex: 1,
  },
  name: {
    ...typography.sectionTitle,
    color: colors.navy,
    fontSize: 22,
    lineHeight: 27,
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
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 36,
  },
  rowLabel: {
    ...typography.body,
    color: colors.muted,
    fontSize: 13,
  },
  rowValue: {
    ...typography.cardTitle,
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
  },
  logoutButton: {
    marginTop: spacing.xl,
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutButtonText: {
    ...typography.cardTitle,
    color: "#FFFFFF",
    fontSize: 15,
  },
});
