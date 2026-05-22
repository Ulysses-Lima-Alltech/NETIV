import { Pressable, StyleSheet, Text, View } from "react-native";
import { brand, colors, radius, spacing, typography } from "../theme";
import { AppIcon } from "./AppIcon";
import { ProfileAvatar } from "./ProfileAvatar";

type HeaderProps = {
  userName: string;
  role: string;
  showMenuButton: boolean;
  onOpenMenu: () => void;
};

export function Header({ userName, role, showMenuButton, onOpenMenu }: HeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.leftBlock}>
        <Text style={styles.brand}>{brand.name}</Text>
        <Text style={styles.subtitle}>Operacao mobile</Text>
      </View>

      <View style={styles.rightBlock}>
        <View style={styles.userChip}>
          <ProfileAvatar name={userName} subtle size={28} />
          <View style={styles.userTextWrap}>
            <Text numberOfLines={1} style={styles.userName}>
              {userName}
            </Text>
            <Text style={styles.userRole}>{role}</Text>
          </View>
        </View>

        {showMenuButton ? (
          <Pressable style={styles.menuButton} onPress={onOpenMenu}>
            <AppIcon name="menu" size={16} color={colors.navy} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: 4,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  leftBlock: {
    flex: 1,
    paddingRight: spacing.xs,
  },
  brand: {
    color: colors.navy,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  subtitle: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 1,
    fontSize: 10,
    lineHeight: 13,
  },
  rightBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  userChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 8,
    maxWidth: 168,
  },
  userTextWrap: {
    minWidth: 0,
  },
  userName: {
    ...typography.caption,
    color: colors.text,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "700",
  },
  userRole: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 9,
    lineHeight: 12,
    marginTop: 1,
  },
  menuButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
