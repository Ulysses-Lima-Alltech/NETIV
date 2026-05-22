import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { brand, colors, radius, spacing, typography } from "../theme";

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
        <Text style={styles.subtitle}>
          {userName} · {role}
        </Text>
      </View>

      {showMenuButton ? (
        <Pressable style={styles.menuButton} onPress={onOpenMenu}>
          <MaterialCommunityIcons name="menu" size={17} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: 6,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  leftBlock: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  brand: {
    color: colors.navy,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  subtitle: {
    ...typography.caption,
    color: colors.navyMuted,
    marginTop: 1,
  },
  menuButton: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.navy,
    borderWidth: 1,
    borderColor: colors.navySoft,
  },
});

