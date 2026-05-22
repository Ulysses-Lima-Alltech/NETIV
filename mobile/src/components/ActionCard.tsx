import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, spacing, typography } from "../theme";

type ActionCardProps = {
  title: string;
  description: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
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
      style={[
        styles.card,
        primary ? styles.cardPrimary : styles.cardSecondary,
      ]}
    >
      <View style={[styles.iconWrap, primary ? styles.iconWrapPrimary : styles.iconWrapSecondary]}>
        <MaterialCommunityIcons
          name={icon}
          size={20}
          color={primary ? colors.orange : colors.navy}
        />
      </View>

      <View style={styles.textWrap}>
        <Text style={[styles.title, primary ? styles.titlePrimary : styles.titleSecondary]}>
          {title}
        </Text>
        <Text
          style={[
            styles.description,
            primary ? styles.descriptionPrimary : styles.descriptionSecondary,
          ]}
        >
          {description}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.card,
  },
  cardPrimary: {
    backgroundColor: colors.navySoft,
    borderColor: colors.navySoft,
  },
  cardSecondary: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapPrimary: {
    backgroundColor: "rgba(255, 255, 255, 0.14)",
  },
  iconWrapSecondary: {
    backgroundColor: colors.warningSoft,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    ...typography.cardTitle,
  },
  titlePrimary: {
    color: "#FFFFFF",
  },
  titleSecondary: {
    color: colors.text,
  },
  description: {
    ...typography.caption,
    marginTop: 1,
  },
  descriptionPrimary: {
    color: "#E2E8F0",
  },
  descriptionSecondary: {
    color: colors.muted,
  },
});
