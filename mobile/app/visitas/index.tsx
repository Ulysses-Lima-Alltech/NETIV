import { FlatList, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { VisitCard } from "../../src/components/VisitCard";
import { colors, spacing, typography } from "../../src/theme";

const visits = [
  {
    id: "1",
    time: "09:30",
    clientName: "Carlos Silva",
    enterpriseName: "Évora",
    status: "Confirmada" as const,
  },
  {
    id: "2",
    time: "14:00",
    clientName: "Mariana Costa",
    enterpriseName: "Montaresa",
    status: "Agendada" as const,
  },
  {
    id: "3",
    time: "17:15",
    clientName: "Rafael Gomes",
    enterpriseName: "Altis",
    status: "Reagendada" as const,
  },
];

export default function VisitsScreen() {
  return (
    <AppShell>
      <FlatList
        contentContainerStyle={styles.container}
        data={visits}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Agenda de visitas</Text>
            <Text style={styles.subtitle}>
              Organize seu dia com status claros e prioridades de atendimento.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <VisitCard
            time={item.time}
            clientName={item.clientName}
            enterpriseName={item.enterpriseName}
            status={item.status}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  header: {
    marginBottom: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.navy,
  },
  subtitle: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  separator: {
    height: spacing.sm,
  },
});

