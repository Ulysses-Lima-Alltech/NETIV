import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { StatusBadge } from "../../src/components/StatusBadge";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";

const team = [
  { name: "João Corretor", role: "CORRETOR", detail: "Évora e Montaresa" },
  { name: "Mariana Corretora", role: "CORRETOR", detail: "Évora" },
  { name: "Lucas Corretor", role: "CORRETOR", detail: "Altis" },
  { name: "Gestor Évora", role: "GESTOR", detail: "Responsável pelo Évora" },
  { name: "Administrador NETIV", role: "ADM", detail: "Acesso total à operação" },
];

export default function TeamScreen() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role ?? "CORRETOR";

  const visibleTeam =
    role === "GESTOR" ? team.filter((member) => member.role === "CORRETOR") : team;

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>{role === "GESTOR" ? "Equipe" : "Equipe e usuários"}</Text>
        <Text style={styles.subtitle}>
          {role === "GESTOR"
            ? "Visualização dos corretores vinculados aos seus empreendimentos."
            : "Corretores, gestores e administradores da operação NETIV."}
        </Text>

        <View style={styles.list}>
          {visibleTeam.map((member) => (
            <View key={`${member.role}-${member.name}`} style={styles.card}>
              <View style={styles.content}>
                <Text style={styles.name}>{member.name}</Text>
                <Text style={styles.detail}>{member.detail}</Text>
              </View>
              <StatusBadge
                label={member.role}
                tone={member.role === "ADM" ? "inverse" : member.role === "GESTOR" ? "warning" : "info"}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  title: {
    ...typography.title,
    color: colors.navy,
  },
  subtitle: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  list: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    ...shadows.card,
  },
  content: {
    flex: 1,
  },
  name: {
    ...typography.cardTitle,
    color: colors.text,
  },
  detail: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 2,
  },
});

