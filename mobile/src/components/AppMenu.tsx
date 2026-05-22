import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "../theme";

export type AppMenuItem = {
  label: string;
  description: string;
  path: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
};

type AppMenuProps = {
  visible: boolean;
  roleLabel: string;
  items: AppMenuItem[];
  onClose: () => void;
  onSelectItem: (path: string) => void;
};

export function AppMenu({ visible, roleLabel, items, onClose, onSelectItem }: AppMenuProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.panel}>
          <View style={styles.handle} />

          <Text style={styles.title}>Menu</Text>
          <Text style={styles.subtitle}>Acessos disponíveis para {roleLabel}</Text>

          <ScrollView contentContainerStyle={styles.items}>
            {items.map((item) => (
              <Pressable
                key={item.path}
                style={styles.item}
                onPress={() => onSelectItem(item.path)}
              >
                <View style={styles.iconBox}>
                  <MaterialCommunityIcons name={item.icon} size={20} color={colors.orange} />
                </View>

                <View style={styles.textBlock}>
                  <Text style={styles.itemTitle}>{item.label}</Text>
                  <Text style={styles.itemDescription}>{item.description}</Text>
                </View>

                <MaterialCommunityIcons name="chevron-right" size={22} color={colors.orange} />
              </Pressable>
            ))}
          </ScrollView>

          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Fechar</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  panel: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    maxHeight: "80%",
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.navy,
    fontSize: 30,
    lineHeight: 35,
  },
  subtitle: {
    ...typography.body,
    color: colors.muted,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  items: {
    gap: spacing.sm,
  },
  item: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  textBlock: {
    flex: 1,
  },
  itemTitle: {
    ...typography.cardTitle,
    color: colors.text,
  },
  itemDescription: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 2,
  },
  closeButton: {
    marginTop: spacing.lg,
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.navy,
  },
  closeButtonText: {
    ...typography.cardTitle,
    color: "#FFFFFF",
  },
});

