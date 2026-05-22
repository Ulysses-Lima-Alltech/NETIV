import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { EmptyState } from "../../src/components/EmptyState";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";

const templateCards = [
  {
    title: "Boas-vindas",
    description: "Mensagem inicial para novos leads com qualificação automática.",
  },
  {
    title: "Agendamento de visita",
    description: "Confirmação de disponibilidade com opção de reagendamento rápido.",
  },
];

export default function TemplatesScreen() {
  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Templates</Text>
        <Text style={styles.subtitle}>
          Biblioteca de mensagens para padronizar atendimento e acelerar conversão.
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
          title="Novos templates em breve"
          description="A área já está preparada para edição, versionamento e ativação por perfil."
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
  cardTitle: {
    ...typography.cardTitle,
    color: colors.text,
  },
  cardText: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
  },
});

