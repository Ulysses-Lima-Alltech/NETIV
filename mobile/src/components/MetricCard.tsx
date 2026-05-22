import { StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, spacing, typography } from "../theme";

type MetricCardProps = {
  label: string;
  value: string;
  footnote?: string;
};

export function MetricCard({ label, value, footnote }: MetricCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      {footnote ? <Text style={styles.footnote}>{footnote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: "46%",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    ...shadows.card,
  },
  value: {
    ...typography.metric,
    fontSize: 28,
    lineHeight: 32,
    color: colors.navy,
  },
  label: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
    marginTop: 6,
  },
  footnote: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
  },
});
