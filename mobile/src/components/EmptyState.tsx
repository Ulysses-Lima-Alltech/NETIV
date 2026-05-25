import { StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, spacing, typography } from "../theme";
import { AppIcon, AppIconName } from "./AppIcon";

type EmptyStateProps = {
  icon: AppIconName;
  title: string;
  description: string;
};

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconBox}>
        <AppIcon name={icon} size={24} color={colors.orange} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing.lg,
    alignItems: "center",
    ...shadows.card,
  },
  iconBox: {
    width: 54,
    height: 54,
    borderRadius: radius.xl,
    backgroundColor: colors.orangeSoft,
    borderWidth: 1,
    borderColor: "#FFD8BD",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...typography.sectionTitle,
    color: colors.navy,
    marginTop: spacing.sm,
    textAlign: "center",
    fontSize: 18,
    lineHeight: 23,
  },
  description: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
    textAlign: "center",
    fontSize: 13,
    lineHeight: 18,
  },
});
