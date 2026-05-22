import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, spacing, typography } from "../theme";

export type BottomNavItem = {
  label: string;
  path: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
};

type BottomNavigationProps = {
  items: BottomNavItem[];
  currentPath: string;
  onNavigate: (path: string) => void;
};

function isPathActive(currentPath: string, path: string) {
  if (path === "/home") return currentPath === "/home";
  return currentPath === path || currentPath.startsWith(`${path}/`);
}

export function BottomNavigation({ items, currentPath, onNavigate }: BottomNavigationProps) {
  return (
    <View style={styles.outer}>
      <View style={styles.container}>
        {items.map((item) => {
          const active = isPathActive(currentPath, item.path);

          return (
            <Pressable
              key={item.path}
              style={[styles.item, active ? styles.itemActive : null]}
              onPress={() => onNavigate(item.path)}
            >
              <MaterialCommunityIcons
                name={item.icon}
                size={20}
                color={active ? colors.navy : colors.muted}
              />
              <Text style={[styles.label, active ? styles.labelActive : null]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    paddingTop: 6,
    paddingBottom: spacing.xs,
  },
  container: {
    flexDirection: "row",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 4,
    ...shadows.card,
  },
  item: {
    flex: 1,
    minHeight: 56,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  itemActive: {
    backgroundColor: colors.backgroundAlt,
  },
  label: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 13,
    color: colors.muted,
  },
  labelActive: {
    color: colors.navy,
    fontWeight: "700",
  },
});

