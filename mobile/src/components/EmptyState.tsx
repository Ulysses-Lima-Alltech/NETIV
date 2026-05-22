import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "../theme";

type EmptyStateProps = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  description: string;
};

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconBox}>
        <MaterialCommunityIcons name={icon} size={28} color={colors.orange} />
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
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: radius.xl,
    backgroundColor: colors.warningSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...typography.sectionTitle,
    color: colors.navy,
    marginTop: spacing.md,
    textAlign: "center",
  },
  description: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
    textAlign: "center",
  },
});

