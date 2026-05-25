import { StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, spacing, typography } from "../theme";
import { StatusBadge } from "./StatusBadge";
import { AppIcon } from "./AppIcon";

type VisitStatus = "Confirmada" | "Agendada" | "Reagendada" | "Concluida";

type VisitCardProps = {
  time: string;
  clientName: string;
  enterpriseName: string;
  status: VisitStatus;
  brokerName: string | null;
};

const toneByStatus: Record<VisitStatus, "success" | "info" | "warning"> = {
  Confirmada: "success",
  Agendada: "info",
  Reagendada: "warning",
  Concluida: "success",
};

export function VisitCard({ time, clientName, enterpriseName, status, brokerName }: VisitCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.timePill}>
          <AppIcon name="clock-outline" size={13} color={colors.navy} />
          <Text style={styles.timeText}>{time}</Text>
        </View>
        <StatusBadge label={status} tone={toneByStatus[status]} />
      </View>

      <Text style={styles.clientName}>{clientName}</Text>
      <Text style={styles.enterpriseName}>{enterpriseName}</Text>
      <Text style={styles.brokerLabel}>Corretor: {brokerName ?? "Nao atribuido"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 5,
    ...shadows.card,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  timePill: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#D6E2F6",
    backgroundColor: colors.blueSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  timeText: {
    ...typography.caption,
    color: colors.navy,
  },
  clientName: {
    ...typography.cardTitle,
    color: colors.navy,
    fontSize: 15,
    lineHeight: 20,
  },
  enterpriseName: {
    ...typography.body,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  brokerLabel: {
    ...typography.caption,
    color: colors.text,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
});
