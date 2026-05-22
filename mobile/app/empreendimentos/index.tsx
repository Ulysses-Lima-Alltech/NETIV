import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { StatusBadge } from "../../src/components/StatusBadge";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";

const allEnterprises = [
  { name: "Evora", stage: "Lancamento", owner: "Gestor Evora" },
  { name: "Montaresa", stage: "Vendas", owner: "Gestor Evora" },
  { name: "Altis", stage: "Pre-lancamento", owner: "Gestor Altis" },
  { name: "Reserva Azul", stage: "Pos-venda", owner: "Gestor Geral" },
];

export default function EnterprisesScreen() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role ?? "CORRETOR";

  const visibleEnterprises =
    role === "GESTOR"
      ? allEnterprises.filter((enterprise) => enterprise.owner === "Gestor Evora")
      : allEnterprises;

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Empreendimentos</Text>
        <Text style={styles.subtitle}>
          {role === "GESTOR"
            ? "Voce visualiza somente os empreendimentos atribuidos ao seu perfil."
            : "Visao consolidada dos empreendimentos da operacao."}
        </Text>

        <View style={styles.list}>
          {visibleEnterprises.map((item) => (
            <View key={item.name} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.name}>{item.name}</Text>
                <StatusBadge label={item.stage} tone="info" />
              </View>
              <Text style={styles.owner}>Responsavel: {item.owner}</Text>
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
    ...typography.sectionTitle,
    color: colors.navy,
    fontSize: 24,
    lineHeight: 29,
  },
  subtitle: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
    fontSize: 13,
    lineHeight: 18,
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
    fontSize: 15,
    lineHeight: 20,
  },
  owner: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
    fontSize: 11,
    lineHeight: 15,
  },
});
