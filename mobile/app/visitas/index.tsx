import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { EmptyState } from "../../src/components/EmptyState";
import { VisitCard } from "../../src/components/VisitCard";
import { ApiRequestError } from "../../src/services/api";
import { getVisitsByRole, getVisitsWithApi } from "../../src/services/visits.service";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";
import { Visit } from "../../src/types/visit.types";

export default function VisitsScreen() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const role = user?.role ?? "CORRETOR";
  const [visits, setVisits] = useState<Visit[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;

    async function loadVisits() {
      setIsLoading(true);

      try {
        if (token) {
          const apiVisits = await getVisitsWithApi(token);
          if (active) {
            setVisits(apiVisits);
          }
          return;
        }
      } catch (error) {
        const isConnectionError =
          error instanceof ApiRequestError &&
          (error.message === "NETWORK_ERROR" || error.status == null || error.status >= 500);
        if (!isConnectionError) {
          if (active) {
            setVisits([]);
          }
          return;
        }

        const fallbackVisits = await getVisitsByRole(user);
        if (active) {
          setVisits(fallbackVisits);
        }
        return;
      }

      const fallbackVisits = await getVisitsByRole(user);
      if (active) {
        setVisits(fallbackVisits);
      }
    }

    loadVisits().finally(() => {
      if (active) {
        setIsLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [token, user]);

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
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={colors.orange} />
              <Text style={styles.loadingText}>Carregando visitas</Text>
            </View>
          ) : (
            <EmptyState
              icon="calendar-check-outline"
              title="Nenhuma visita disponível"
              description="Quando houver visitas dentro do seu acesso, elas aparecerão aqui."
            />
          )
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
  loadingCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    ...shadows.card,
  },
  loadingText: {
    ...typography.caption,
    color: colors.muted,
  },
});
