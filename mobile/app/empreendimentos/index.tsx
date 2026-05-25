import { ScrollView, StyleSheet, Text } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { EmptyState } from "../../src/components/EmptyState";
import { colors, spacing, typography } from "../../src/theme";

export default function EnterprisesScreen() {
  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Empreendimentos</Text>
        <Text style={styles.subtitle}>No mobile, exibimos apenas areas conectadas aos dados reais.</Text>

        <EmptyState
          icon="office-building-outline"
          title="Empreendimentos indisponiveis"
          description="Esta area sera conectada aos dados reais da operacao."
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
});
