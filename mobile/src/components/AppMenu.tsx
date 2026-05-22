import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, spacing, typography } from "../theme";
import { AppIcon, AppIconName } from "./AppIcon";

export type AppMenuItem = {
  label: string;
  description: string;
  path: string;
  icon: AppIconName;
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

          <Text style={styles.title}>Menu administrativo</Text>
          <Text style={styles.subtitle}>Acessos disponiveis para {roleLabel}</Text>

          <ScrollView contentContainerStyle={styles.items}>
            {items.map((item) => (
              <Pressable key={item.path} style={styles.item} onPress={() => onSelectItem(item.path)}>
                <View style={styles.iconBox}>
                  <AppIcon name={item.icon} size={17} color={colors.orange} />
                </View>

                <View style={styles.textBlock}>
                  <Text style={styles.itemTitle}>{item.label}</Text>
                  <Text style={styles.itemDescription}>{item.description}</Text>
                </View>

                <AppIcon name="chevron-right" size={19} color={colors.muted} />
              </Pressable>
            ))}
          </ScrollView>

          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Fechar menu</Text>
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
    width: 42,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.navy,
    fontSize: 22,
    lineHeight: 27,
  },
  subtitle: {
    ...typography.body,
    color: colors.muted,
    marginTop: 4,
    marginBottom: spacing.md,
    fontSize: 13,
    lineHeight: 18,
  },
  items: {
    gap: spacing.sm,
  },
  item: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.card,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.orangeSoft,
    borderWidth: 1,
    borderColor: "#FFD8BD",
    alignItems: "center",
    justifyContent: "center",
  },
  textBlock: {
    flex: 1,
  },
  itemTitle: {
    ...typography.cardTitle,
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
  },
  itemDescription: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 1,
    fontSize: 10,
    lineHeight: 14,
  },
  closeButton: {
    marginTop: spacing.lg,
    minHeight: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.navy,
  },
  closeButtonText: {
    ...typography.cardTitle,
    color: "#FFFFFF",
    fontSize: 15,
  },
});
