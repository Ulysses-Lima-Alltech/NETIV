import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, spacing, typography } from "../theme";
import { StatusBadge } from "./StatusBadge";

type ConversationCardProps = {
  clientName: string;
  enterpriseName: string;
  lastMessage: string;
  anaStatus: "Ana atendendo" | "Atendimento humano";
  needsHuman: boolean;
  assignedBrokerName?: string;
  showAssignedBroker?: boolean;
  unread: boolean;
  onPress: () => void;
};

export function ConversationCard({
  clientName,
  enterpriseName,
  lastMessage,
  anaStatus,
  needsHuman,
  assignedBrokerName,
  showAssignedBroker = false,
  unread,
  onPress,
}: ConversationCardProps) {
  const shouldShowAssignment =
    showAssignedBroker && Boolean(assignedBrokerName) && (anaStatus === "Atendimento humano" || needsHuman);

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
        <StatusBadge label={anaStatus} tone={anaStatus === "Ana atendendo" ? "info" : "warning"} />
        {needsHuman ? <StatusBadge label="Precisa humano" tone="danger" /> : null}
      </View>

      {shouldShowAssignment ? (
        <View style={styles.assignmentChip}>
          <Text numberOfLines={1} style={styles.assignmentText}>
            {`${assignedBrokerName}`}
          </Text>
        </View>
      ) : null}
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
    paddingVertical: 10,
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
    color: colors.navy,
    fontSize: 15,
    lineHeight: 19,
  },
  enterpriseName: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 1,
    fontSize: 11,
    lineHeight: 14,
  },
  message: {
    ...typography.body,
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  assignmentChip: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#D5E3FF",
    backgroundColor: colors.blueSoft,
    paddingHorizontal: 9,
    paddingVertical: 2,
    maxWidth: "100%",
  },
  assignmentText: {
    ...typography.caption,
    color: colors.navy,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "700",
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.orange,
    marginTop: 2,
  },
});
