import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, spacing, typography } from "../theme";
import { AppIcon, AppIconName } from "./AppIcon";

export type BottomNavItem = {
  label: string;
  path: string;
  icon: AppIconName;
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
              <View style={[styles.iconWrap, active ? styles.iconWrapActive : null]}>
                <AppIcon
                  name={item.icon}
                  size={active ? 27 : 24}
                  color={active ? colors.card : colors.navy}
                />
              </View>
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
    paddingTop: spacing.xxs,
    paddingBottom: spacing.xs,
  },
  container: {
    flexDirection: "row",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    ...shadows.card,
  },
  item: {
    flex: 1,
    minHeight: 62,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 5,
  },
  itemActive: {
    backgroundColor: colors.navySoft,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.backgroundAlt,
  },
  iconWrapActive: {
    width: 44,
    height: 44,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
  },
  label: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 14,
    color: colors.navyMuted,
    fontWeight: "700",
  },
  labelActive: {
    color: colors.card,
    fontWeight: "700",
  },
});
