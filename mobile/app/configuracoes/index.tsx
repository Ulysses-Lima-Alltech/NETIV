import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { EmptyState } from "../../src/components/EmptyState";
import { StatusBadge } from "../../src/components/StatusBadge";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";

const configGroups = [
  {
    title: "Atendimento da Ana",
    description: "Regras de handoff, horários e prioridade de encaminhamento humano.",
    status: "Ativo",
  },
  {
    title: "Permissões de acesso",
    description: "Controle de perfis e visibilidade de módulos administrativos.",
    status: "Revisão",
  },
  {
    title: "Integrações comerciais",
    description: "Conectores e automações de CRM para sincronização de leads.",
    status: "Planejado",
  },
];

function getTone(status: string): "success" | "warning" | "info" {
  if (status === "Ativo") return "success";
  if (status === "Revisão") return "warning";
  return "info";
}

export default function SettingsScreen() {
  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Configurações</Text>
        <Text style={styles.subtitle}>
          Área administrativa para governança da operação e evolução do app.
        </Text>

        <View style={styles.list}>
          {configGroups.map((item) => (
            <View key={item.title} style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <StatusBadge label={item.status} tone={getTone(item.status)} />
              </View>
              <Text style={styles.cardDescription}>{item.description}</Text>
            </View>
          ))}
        </View>

        <EmptyState
          icon="cog-refresh-outline"
          title="Painel de ajustes em evolução"
          description="A próxima entrega trará permissões avançadas, histórico de mudanças e auditoria."
        />
      </ScrollView>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.navy,
  },
  subtitle: {
    ...typography.body,
    color: colors.muted,
  },
  list: {
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
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.cardTitle,
    color: colors.text,
    flex: 1,
  },
  cardDescription: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
  },
});

