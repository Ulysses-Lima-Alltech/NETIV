import { StyleSheet, Text } from "react-native";

export type AppIconName =
  | "home-variant-outline"
  | "message-text-outline"
  | "calendar-month-outline"
  | "account-circle-outline"
  | "account-multiple-outline"
  | "office-building-outline"
  | "file-document-multiple-outline"
  | "cog-outline"
  | "message-processing-outline"
  | "calendar-check-outline"
  | "account-group-outline"
  | "shield-crown-outline"
  | "file-plus-outline"
  | "cog-refresh-outline"
  | "chevron-right"
  | "clock-outline"
  | "menu"
  | "account-switch-outline"
  | "send";

type AppIconProps = {
  name: AppIconName;
  size?: number;
  color?: string;
};

const ICON_SYMBOLS: Record<AppIconName, string> = {
  "home-variant-outline": "\u{1F3E0}",
  "message-text-outline": "\u{1F4AC}",
  "calendar-month-outline": "\u{1F4C5}",
  "account-circle-outline": "\u{1F464}",
  "account-multiple-outline": "\u25CD",
  "office-building-outline": "\u25A6",
  "file-document-multiple-outline": "\u25A4",
  "cog-outline": "\u2699",
  "message-processing-outline": "\u2709",
  "calendar-check-outline": "\u2713",
  "account-group-outline": "\u25CD",
  "shield-crown-outline": "\u265B",
  "file-plus-outline": "+",
  "cog-refresh-outline": "\u21BB",
  "chevron-right": "\u203A",
  "clock-outline": "\u25F7",
  menu: "\u2630",
  "account-switch-outline": "\u21C4",
  send: "\u27A4",
};

export function AppIcon({ name, size = 16, color = "#303740" }: AppIconProps) {
  return (
    <Text
      style={[
        styles.icon,
        {
          color,
          fontSize: size,
          lineHeight: Math.round(size * 1.15),
        },
      ]}
    >
      {ICON_SYMBOLS[name] ?? "\u2022"}
    </Text>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontWeight: "700",
    textAlign: "center",
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});
