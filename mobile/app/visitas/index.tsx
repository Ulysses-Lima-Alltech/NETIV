import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { VisitCard } from "../../src/components/VisitCard";
import { getVisitsByRole } from "../../src/services/visits.service";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";
import { Visit } from "../../src/types/visit.types";

export default function VisitsScreen() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role ?? "CORRETOR";
  const [visits, setVisits] = useState<Visit[]>([]);

  useEffect(() => {
    let active = true;

    getVisitsByRole(user).then((items) => {
      if (active) {
        setVisits(items);
      }
    });

    return () => {
      active = false;
    };
  }, [user]);

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
        data={visits}
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
            brokerName={item.assignedBrokerName}
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
