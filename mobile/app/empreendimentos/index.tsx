import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { StatusBadge } from "../../src/components/StatusBadge";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";

const allEnterprises = [
  { name: "Évora", stage: "Lançamento", owner: "Gestor Évora" },
  { name: "Montaresa", stage: "Vendas", owner: "Gestor Évora" },
  { name: "Altis", stage: "Pré-lançamento", owner: "Gestor Altis" },
  { name: "Reserva Azul", stage: "Pós-venda", owner: "Gestor Geral" },
];

export default function EnterprisesScreen() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role ?? "CORRETOR";

  const visibleEnterprises =
    role === "GESTOR"
      ? allEnterprises.filter((enterprise) => enterprise.owner === "Gestor Évora")
      : allEnterprises;

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Empreendimentos</Text>
        <Text style={styles.subtitle}>
          {role === "GESTOR"
            ? "Você visualiza somente os empreendimentos atribuídos ao seu perfil."
            : "Visão consolidada dos empreendimentos da operação."}
        </Text>

        <View style={styles.list}>
          {visibleEnterprises.map((item) => (
            <View key={item.name} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.name}>{item.name}</Text>
                <StatusBadge label={item.stage} tone="info" />
              </View>
              <Text style={styles.owner}>Responsável: {item.owner}</Text>
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
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  name: {
    ...typography.cardTitle,
    color: colors.navy,
    flex: 1,
  },
  owner: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
  },
});

