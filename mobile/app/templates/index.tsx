import { ScrollView, StyleSheet, Text } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { EmptyState } from "../../src/components/EmptyState";
import { colors, spacing, typography } from "../../src/theme";

export default function TemplatesScreen() {
  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Templates</Text>
        <Text style={styles.subtitle}>Esta area sera liberada no mobile quando o fluxo real estiver disponivel.</Text>

        <EmptyState
          icon="file-document-multiple-outline"
          title="Templates indisponiveis"
          description="Templates ainda nao estao disponiveis no mobile."
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
