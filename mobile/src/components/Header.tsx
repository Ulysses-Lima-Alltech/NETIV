import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { brand, colors, spacing, typography } from "../theme";

type HeaderProps = {
  userName: string;
  role: string;
  showMenuButton: boolean;
  onOpenMenu: () => void;
};

export function Header({ userName, role, showMenuButton, onOpenMenu }: HeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.brandBlock}>
        <Text style={styles.brand}>{brand.name}</Text>
        <Text style={styles.subtitle}>
          {userName} · {role}
        </Text>
      </View>

      {showMenuButton ? (
        <Pressable style={styles.menuButton} onPress={onOpenMenu}>
          <MaterialCommunityIcons name="menu" size={18} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.md,
    paddingTop: 6,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#0D314F",
  },
  brandBlock: {
    flex: 1,
    paddingRight: spacing.md,
  },
  brand: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 1.2,
  },
  subtitle: {
    ...typography.caption,
    color: "#CFD9E4",
    marginTop: 0,
  },
  menuButton: {
    backgroundColor: colors.orange,
    borderRadius: 999,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
});
