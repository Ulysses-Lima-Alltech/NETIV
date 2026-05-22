import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, spacing, typography } from "../theme";
import { StatusBadge } from "./StatusBadge";

type ConversationCardProps = {
  clientName: string;
  enterpriseName: string;
  lastMessage: string;
  anaStatus: "Ana atendendo" | "Atendimento humano";
  needsHuman: boolean;
  unread: boolean;
  onPress: () => void;
};

export function ConversationCard({
  clientName,
  enterpriseName,
  lastMessage,
  anaStatus,
  needsHuman,
  unread,
  onPress,
}: ConversationCardProps) {
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.titleWrap}>
          <Text style={styles.clientName}>{clientName}</Text>
          <Text style={styles.enterpriseName}>{enterpriseName}</Text>
        </View>
        {unread ? <View style={styles.unreadDot} /> : null}
      </View>

      <Text numberOfLines={2} style={styles.message}>
        {lastMessage}
      </Text>

      <View style={styles.bottomRow}>
        <StatusBadge
          label={anaStatus}
          tone={anaStatus === "Ana atendendo" ? "info" : "warning"}
        />
        {needsHuman ? <StatusBadge label="Precisa humano" tone="danger" /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 6,
    ...shadows.card,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  titleWrap: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  clientName: {
    ...typography.cardTitle,
    fontSize: 15,
    lineHeight: 20,
    color: colors.navy,
  },
  enterpriseName: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 14,
    color: colors.muted,
    marginTop: 1,
  },
  message: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    marginTop: 2,
  },
});
