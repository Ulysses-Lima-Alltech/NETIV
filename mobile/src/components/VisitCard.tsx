import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, spacing, typography } from "../theme";
import { StatusBadge } from "./StatusBadge";

type VisitStatus = "Confirmada" | "Agendada" | "Reagendada" | "Concluída";

type VisitCardProps = {
  time: string;
  clientName: string;
  enterpriseName: string;
  status: VisitStatus;
};

const toneByStatus: Record<VisitStatus, "success" | "info" | "warning"> = {
  Confirmada: "success",
  Agendada: "info",
  Reagendada: "warning",
  Concluída: "success",
};

export function VisitCard({ time, clientName, enterpriseName, status }: VisitCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.timePill}>
        <MaterialCommunityIcons name="clock-outline" size={15} color={colors.navy} />
        <Text style={styles.timeText}>{time}</Text>
      </View>

      <Text style={styles.clientName}>{clientName}</Text>
      <Text style={styles.enterpriseName}>{enterpriseName}</Text>

      <View style={styles.footer}>
        <StatusBadge label={status} tone={toneByStatus[status]} />
      </View>
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
    ...shadows.card,
  },
  timePill: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#D7E3F8",
    backgroundColor: colors.blueSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  timeText: {
    ...typography.caption,
    color: colors.navy,
  },
  clientName: {
    ...typography.cardTitle,
    color: colors.navy,
    marginTop: spacing.sm,
  },
  enterpriseName: {
    ...typography.body,
    color: colors.muted,
    marginTop: 2,
  },
  footer: {
    marginTop: spacing.sm,
  },
});

