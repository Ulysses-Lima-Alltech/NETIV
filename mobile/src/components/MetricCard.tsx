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
    minWidth: "47%",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.card,
  },
  value: {
    ...typography.metric,
    fontSize: 30,
    lineHeight: 34,
    color: colors.navy,
  },
  label: {
    ...typography.body,
    color: colors.text,
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
  },
  footnote: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 6,
  },
});
