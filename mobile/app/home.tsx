import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { ActionCard } from "../src/components/ActionCard";
import { AppShell } from "../src/components/AppShell";
import { MetricCard } from "../src/components/MetricCard";
import { getHomeSummaryByRole, getHomeSummaryWithApi } from "../src/services/home.service";
import { useAuthStore } from "../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../src/theme";
import { UserRole } from "../src/types/auth.types";
import { HomeMetric, HomeSummary } from "../src/types/home.types";

const INITIAL_HOME_SUMMARY: HomeSummary = {
  title: "Carregando resumo",
  subtitle: "Usuario",
  description: "Aguarde enquanto carregamos os indicadores do seu perfil.",
  nextActionText: "",
  metrics: [],
};

const ROLE_COPY: Record<
  UserRole,
  {
    title: string;
    subtitle: string;
  }
> = {
  ADM: {
    title: "Resumo da operacao",
    subtitle: "Acompanhe gargalos, acessos e atividade comercial.",
  },
  GESTOR: {
    title: "Resumo da equipe",
    subtitle: "Veja conversas, visitas e corretores sob sua gestao.",
  },
  CORRETOR: {
    title: "Resumo do atendimento",
    subtitle: "Priorize conversas e visitas que exigem acao.",
  },
};

const METRIC_PRIORITY_BY_ROLE: Record<UserRole, string[]> = {
  ADM: ["conversas sem responsavel", "atendimento humano", "visitas hoje", "acesso mobile", "corretores ativos"],
  GESTOR: ["conversas sem responsavel", "visitas hoje", "corretores ativos", "leads"],
  CORRETOR: ["conversas aguardando", "visitas hoje", "atendimento humano", "leads ativos", "leads"],
};

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function rankMetric(metric: HomeMetric, role: UserRole): number {
  const normalizedLabel = normalizeText(metric.label);
  const priorityList = METRIC_PRIORITY_BY_ROLE[role];
  const index = priorityList.findIndex((priority) => normalizedLabel.includes(priority));

  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function pickTopMetrics(metrics: HomeMetric[], role: UserRole): HomeMetric[] {
  if (!metrics.length) return [];

  const ranked = metrics
    .map((metric, position) => ({
      metric,
      position,
      rank: rankMetric(metric, role),
    }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.position - b.position;
    });

  return ranked.slice(0, 4).map((item) => item.metric);
}

export default function HomeScreen() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const role = (user?.role ?? "CORRETOR") as UserRole;
  const [content, setContent] = useState<HomeSummary>(INITIAL_HOME_SUMMARY);
  const [isRefreshingSummary, setIsRefreshingSummary] = useState<boolean>(false);

  useEffect(() => {
    let active = true;

    async function loadSummary() {
      setIsRefreshingSummary(true);

      try {
        if (token) {
          const summaryFromApi = await getHomeSummaryWithApi(token);
          if (active) {
            setContent(summaryFromApi);
          }
          return;
        }
      } catch {
        // fallback para resumo local quando API estiver indisponivel
      }

      const fallbackSummary = await getHomeSummaryByRole(user);
      if (active) {
        setContent(fallbackSummary);
      }

      if (active) {
        setIsRefreshingSummary(false);
      }
    }

    loadSummary().finally(() => {
      if (active) {
        setIsRefreshingSummary(false);
      }
    });

    return () => {
      active = false;
    };
  }, [token, user]);

  const roleCopy = ROLE_COPY[role];
  const topMetrics = useMemo(() => pickTopMetrics(content.metrics, role), [content.metrics, role]);

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.summaryTop}>
          <Text style={styles.summaryTitle}>{roleCopy.title}</Text>
          <Text style={styles.summarySubtitle}>{roleCopy.subtitle}</Text>
          {isRefreshingSummary ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.orange} />
              <Text style={styles.loadingText}>Atualizando indicadores</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.grid}>
          {topMetrics.map((metric) => (
            <MetricCard key={metric.label} label={metric.label} value={metric.value} />
          ))}
        </View>

        <View style={styles.sectionHeaderWrap}>
          <Text style={styles.sectionTitle}>Acoes rapidas</Text>
        </View>

        <View style={styles.actionList}>
          <ActionCard
            title="Abrir conversas"
            description="Entrar na inbox e manter atendimento ativo."
            icon="message-text-outline"
            onPress={() => router.push("/conversas")}
            variant="primary"
          />

          {(role === "GESTOR" || role === "ADM") ? (
            <ActionCard
              title="Ver equipe"
              description="Acompanhar estrutura e disponibilidade da equipe."
              icon="account-group-outline"
              onPress={() => router.push("/equipe")}
            />
          ) : null}

          <ActionCard
            title="Ver visitas"
            description="Revisar agenda e status de visitas do dia."
            icon="calendar-check-outline"
            onPress={() => router.push("/visitas")}
          />

          {role === "ADM" ? (
            <ActionCard
              title="Acessos mobile"
              description="Controlar usuarios com acesso ao app mobile."
              icon="shield-crown-outline"
              onPress={() => router.push("/acessos-mobile")}
            />
          ) : null}
        </View>
      </ScrollView>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  summaryTop: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  summaryTitle: {
    ...typography.cardTitle,
    color: colors.navy,
    fontSize: 21,
    lineHeight: 25,
  },
  summarySubtitle: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  loadingRow: {
    marginTop: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  loadingText: {
    ...typography.caption,
    color: colors.orange,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  sectionHeaderWrap: {
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.cardTitle,
    color: colors.navy,
    fontSize: 16,
    lineHeight: 20,
  },
  actionList: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
});
