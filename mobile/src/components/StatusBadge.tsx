import { StyleSheet, Text, View } from "react-native";
import { colors, radius, typography } from "../theme";

type BadgeTone = "info" | "success" | "warning" | "danger" | "neutral" | "inverse";

type StatusBadgeProps = {
  label: string;
  tone?: BadgeTone;
};

const toneStyles: Record<BadgeTone, { bg: string; text: string; border: string }> = {
  info: { bg: colors.blueSoft, text: colors.blue, border: "#D5E3FF" },
  success: { bg: colors.successSoft, text: colors.green, border: "#D2EED1" },
  warning: { bg: colors.warningSoft, text: colors.orange, border: "#FFD7BC" },
  danger: { bg: colors.redSoft, text: colors.red, border: "#FFC8CA" },
  neutral: { bg: "#F2F4F7", text: colors.muted, border: "#E4E7EC" },
  inverse: { bg: colors.navy, text: "#FFFFFF", border: colors.navy },
};

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  const toneStyle = toneStyles[tone];

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: toneStyle.bg,
          borderColor: toneStyle.border,
        },
      ]}
    >
      <Text style={[styles.text, { color: toneStyle.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  text: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "700",
  },
});
