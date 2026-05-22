import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { EmptyState } from "../../src/components/EmptyState";
import { StatusBadge } from "../../src/components/StatusBadge";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";

const configGroups = [
  {
    title: "Atendimento da Ana",
    description: "Regras de handoff, janelas de atendimento e prioridade de encaminhamento humano.",
    status: "Ativo",
  },
  {
    title: "Permissoes de acesso",
    description: "Controle de perfis e visibilidade dos modulos administrativos.",
    status: "Revisao",
  },
  {
    title: "Integracoes comerciais",
    description: "Mapa de conectores de CRM para sincronizacao de leads e historico.",
    status: "Planejado",
  },
];

function getTone(status: string): "success" | "warning" | "info" {
  if (status === "Ativo") return "success";
  if (status === "Revisao") return "warning";
  return "info";
}

export default function SettingsScreen() {
  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Configuracoes</Text>
        <Text style={styles.subtitle}>
          Painel administrativo com visao de governanca da operacao e evolucao do produto.
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
          title="Centro de ajustes em evolucao"
          description="As proximas entregas incluirao trilha de auditoria, historico de alteracoes e politicas avancadas de permissao."
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
    ...typography.sectionTitle,
    color: colors.navy,
    fontSize: 24,
    lineHeight: 29,
  },
  subtitle: {
    ...typography.body,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
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
    fontSize: 15,
    lineHeight: 20,
  },
  cardDescription: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
    fontSize: 12,
    lineHeight: 16,
  },
});
