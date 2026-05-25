import { StyleSheet, Text, View } from "react-native";
import { colors, radius, typography } from "../theme";

type ProfileAvatarProps = {
  name?: string;
  size?: number;
  subtle?: boolean;
};

function getInitials(name?: string) {
  if (!name) return "N";

  const parts = name
    .trim()
    .split(" ")
    .filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 1).toUpperCase();
  }

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function ProfileAvatar({ name, size = 40, subtle = false }: ProfileAvatarProps) {
  const avatarStyles = {
    width: size,
    height: size,
    borderRadius: radius.pill,
    backgroundColor: subtle ? colors.blueSoft : colors.navy,
    borderColor: subtle ? "#D9E6FF" : colors.navySoft,
  };

  const textStyles = {
    color: subtle ? colors.navy : "#FFFFFF",
    fontSize: Math.max(12, Math.round(size * 0.38)),
    lineHeight: Math.max(14, Math.round(size * 0.42)),
  };

  return (
    <View style={[styles.avatar, avatarStyles]}>
      <Text style={[styles.initials, textStyles]}>{getInitials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    ...typography.cardTitle,
    fontWeight: "800",
  },
});
