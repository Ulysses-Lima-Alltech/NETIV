import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { ActionCard } from "../src/components/ActionCard";
import { AppShell } from "../src/components/AppShell";
import { MetricCard } from "../src/components/MetricCard";
import { getHomeSummaryByRole, getHomeSummaryWithApi } from "../src/services/home.service";
import { useAuthStore } from "../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../src/theme";
import { HomeSummary } from "../src/types/home.types";

const INITIAL_HOME_SUMMARY: HomeSummary = {
  title: "Carregando painel",
  subtitle: "Usuario",
  description: "Aguarde enquanto carregamos os indicadores do seu perfil.",
  nextActionText: "Carregando proxima acao.",
  metrics: [],
};

export default function HomeScreen() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const role = user?.role ?? "CORRETOR";
  const isAdmin = role === "ADM";
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

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.hero, isAdmin ? styles.heroCompact : null]}>
          <View style={styles.heroPill}>
            <Text style={styles.heroPillText}>NETIV</Text>
          </View>
          <Text style={[styles.title, isAdmin ? styles.titleCompact : null]}>{content.title}</Text>
          <Text style={styles.subtitle}>{content.subtitle}</Text>
          <Text style={[styles.description, isAdmin ? styles.descriptionCompact : null]}>{content.description}</Text>
          {isRefreshingSummary ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.orange} />
              <Text style={styles.loadingText}>Atualizando painel</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.grid}>
          {content.metrics.map((metric) => (
            <MetricCard key={metric.label} label={metric.label} value={metric.value} />
          ))}
        </View>

        <View style={styles.nextAction}>
          <Text style={styles.nextActionLabel}>Proxima acao</Text>
          <Text style={styles.nextActionText}>{content.nextActionText}</Text>
        </View>

        <View style={styles.actionList}>
          <ActionCard
            title="Abrir conversas"
            description="Entrar na inbox e manter atendimento ativo."
            icon="message-text-outline"
            onPress={() => router.push("/conversas")}
            variant="primary"
          />

          {role === "CORRETOR" ? (
            <ActionCard
              title="Ver visitas"
              description="Revisar agenda e status do dia."
              icon="calendar-check-outline"
              onPress={() => router.push("/visitas")}
            />
          ) : null}

          {role === "GESTOR" ? (
            <>
              <ActionCard
                title="Ver equipe"
                description="Acompanhar corretores vinculados."
                icon="account-group-outline"
                onPress={() => router.push("/equipe")}
              />
              <ActionCard
                title="Ver visitas"
                description="Acompanhar agenda dos empreendimentos sob sua gestao."
                icon="calendar-check-outline"
                onPress={() => router.push("/visitas")}
              />
            </>
          ) : null}

          {role === "ADM" ? (
            <>
              <ActionCard
                title="Ver equipe"
                description="Gerenciar acessos de corretores, gestores e admin."
                icon="account-group-outline"
                onPress={() => router.push("/equipe")}
              />
              <ActionCard
                title="Ver visitas"
                description="Acompanhar a agenda operacional consolidada."
                icon="calendar-check-outline"
                onPress={() => router.push("/visitas")}
              />
            </>
          ) : null}
        </View>
      </ScrollView>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  hero: {
    borderRadius: radius.xl,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  heroCompact: {
    paddingVertical: spacing.sm,
  },
  heroPill: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    backgroundColor: colors.orangeSoft,
    borderWidth: 1,
    borderColor: "#FFD8BD",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginBottom: spacing.xs,
  },
  heroPillText: {
    ...typography.caption,
    color: colors.orange,
  },
  title: {
    ...typography.title,
    color: colors.navy,
    fontSize: 28,
    lineHeight: 32,
  },
  titleCompact: {
    fontSize: 23,
    lineHeight: 27,
  },
  subtitle: {
    ...typography.cardTitle,
    color: colors.text,
    marginTop: 1,
  },
  description: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
    fontSize: 13,
    lineHeight: 18,
  },
  descriptionCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  loadingRow: {
    marginTop: spacing.sm,
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
  nextAction: {
    backgroundColor: colors.navy,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  nextActionLabel: {
    ...typography.caption,
    color: "#D8E2ED",
    fontSize: 11,
    lineHeight: 15,
  },
  nextActionText: {
    ...typography.body,
    color: "#FFFFFF",
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  actionList: {
    gap: spacing.sm,
  },
});
