import { useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { VisitCard } from "../../src/components/VisitCard";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";

type VisitItem = {
  id: string;
  time: string;
  clientName: string;
  enterpriseName: string;
  status: "Confirmada" | "Agendada" | "Reagendada";
  brokerName: string;
};

const MANAGED_BY_GESTOR = ["Evora", "Montaresa"];

const visits: VisitItem[] = [
  {
    id: "1",
    time: "09:30",
    clientName: "Carlos Silva",
    enterpriseName: "Evora",
    status: "Confirmada",
    brokerName: "Joao Corretor",
  },
  {
    id: "2",
    time: "14:00",
    clientName: "Mariana Costa",
    enterpriseName: "Montaresa",
    status: "Agendada",
    brokerName: "Mariana Corretora",
  },
  {
    id: "3",
    time: "17:15",
    clientName: "Rafael Gomes",
    enterpriseName: "Altis",
    status: "Reagendada",
    brokerName: "Lucas Corretor",
  },
];

function getBrokerForCorretor(username?: string) {
  if (username === "corretor") return "Joao Corretor";
  return "Joao Corretor";
}

export default function VisitsScreen() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role ?? "CORRETOR";

  const filteredVisits = useMemo(() => {
    if (role === "ADM") {
      return visits;
    }

    if (role === "GESTOR") {
      return visits.filter((visit) => MANAGED_BY_GESTOR.includes(visit.enterpriseName));
    }

    const myBroker = getBrokerForCorretor(user?.username);
    return visits.filter((visit) => visit.brokerName === myBroker);
  }, [role, user?.username]);

  const subtitle =
    role === "ADM"
      ? "Visao completa da agenda com corretor atribuido em cada visita."
      : role === "GESTOR"
        ? "Visitas dos empreendimentos sob sua gestao, com corretor atribuido."
        : "Visitas atribuidas ao seu atendimento comercial.";

  return (
    <AppShell>
      <FlatList
        contentContainerStyle={styles.container}
        data={filteredVisits}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.headerCard}>
            <Text style={styles.title}>Agenda de visitas</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <VisitCard
            time={item.time}
            clientName={item.clientName}
            enterpriseName={item.enterpriseName}
            status={item.status}
            brokerName={item.brokerName}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  headerCard: {
    marginBottom: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.card,
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
    fontSize: 13,
    lineHeight: 18,
  },
  separator: {
    height: spacing.xs,
  },
});
