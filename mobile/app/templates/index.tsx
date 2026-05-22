import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { EmptyState } from "../../src/components/EmptyState";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";

const templateCards = [
  {
    title: "Boas-vindas comercial",
    description: "Mensagem inicial com qualificacao de interesse e faixa de investimento.",
  },
  {
    title: "Agendamento de visita",
    description: "Fluxo padrao para confirmar horario, local e lembrete automatico.",
  },
  {
    title: "Retomada de lead",
    description: "Sequencia para reativar contatos frios com linguagem consultiva.",
  },
];

export default function TemplatesScreen() {
  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Templates</Text>
        <Text style={styles.subtitle}>
          Biblioteca de mensagens preparada para acelerar atendimento e manter padrao premium.
        </Text>

        <View style={styles.list}>
          {templateCards.map((item) => (
            <View key={item.title} style={styles.card}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardText}>{item.description}</Text>
            </View>
          ))}
        </View>

        <EmptyState
          icon="file-plus-outline"
          title="Editor visual em preparacao"
          description="Esta area sera conectada ao fluxo de versoes, aprovacoes e ativacao por perfil sem impacto no atendimento atual."
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
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  cardTitle: {
    ...typography.cardTitle,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
  },
  cardText: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
    fontSize: 12,
    lineHeight: 16,
  },
});
