import Ionicons from "@expo/vector-icons/Ionicons";
import { ComponentProps } from "react";
import { StyleSheet, View } from "react-native";

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

type IoniconName = ComponentProps<typeof Ionicons>["name"];

const ICON_NAMES: Record<AppIconName, IoniconName> = {
  "home-variant-outline": "home-outline",
  "message-text-outline": "chatbubble-ellipses-outline",
  "calendar-month-outline": "calendar-outline",
  "account-circle-outline": "person-circle-outline",
  "account-multiple-outline": "people-outline",
  "office-building-outline": "business-outline",
  "file-document-multiple-outline": "documents-outline",
  "cog-outline": "settings-outline",
  "message-processing-outline": "chatbubbles-outline",
  "calendar-check-outline": "calendar-clear-outline",
  "account-group-outline": "people-circle-outline",
  "shield-crown-outline": "shield-checkmark-outline",
  "file-plus-outline": "document-text-outline",
  "cog-refresh-outline": "refresh-outline",
  "chevron-right": "chevron-forward",
  "clock-outline": "time-outline",
  menu: "menu",
  "account-switch-outline": "swap-horizontal-outline",
  send: "send",
};

export function AppIcon({ name, size = 16, color = "#303740" }: AppIconProps) {
  return (
    <View style={styles.iconWrap}>
      <Ionicons name={ICON_NAMES[name]} size={size} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
