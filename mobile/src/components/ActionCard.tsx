import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, spacing, typography } from "../theme";
import { AppIcon, AppIconName } from "./AppIcon";

type ActionCardProps = {
  title: string;
  description: string;
  icon: AppIconName;
  onPress: () => void;
  variant?: "primary" | "secondary";
};

export function ActionCard({
  title,
  description,
  icon,
  onPress,
  variant = "secondary",
}: ActionCardProps) {
  const primary = variant === "primary";

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, primary ? styles.cardPrimary : styles.cardSecondary]}
    >
      <View style={[styles.iconWrap, primary ? styles.iconWrapPrimary : styles.iconWrapSecondary]}>
        <AppIcon name={icon} size={16} color={primary ? colors.orange : colors.navy} />
      </View>

      <View style={styles.textWrap}>
        <Text style={[styles.title, primary ? styles.titlePrimary : styles.titleSecondary]}>{title}</Text>
        <Text
          style={[
            styles.description,
            primary ? styles.descriptionPrimary : styles.descriptionSecondary,
          ]}
        >
          {description}
        </Text>
      </View>

      <AppIcon name="chevron-right" size={18} color={primary ? "#FFFFFF" : colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.card,
  },
  cardPrimary: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  cardSecondary: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapPrimary: {
    backgroundColor: "rgba(255, 255, 255, 0.13)",
  },
  iconWrapSecondary: {
    backgroundColor: colors.orangeSoft,
    borderWidth: 1,
    borderColor: "#FFD6B7",
  },
  textWrap: {
    flex: 1,
  },
  title: {
    ...typography.cardTitle,
    fontSize: 15,
    lineHeight: 20,
  },
  titlePrimary: {
    color: "#FFFFFF",
  },
  titleSecondary: {
    color: colors.text,
  },
  description: {
    ...typography.caption,
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
  },
  descriptionPrimary: {
    color: "#D7E0EA",
  },
  descriptionSecondary: {
    color: colors.muted,
  },
});
