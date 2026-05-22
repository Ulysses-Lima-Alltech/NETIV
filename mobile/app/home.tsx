import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ActionCard } from "../src/components/ActionCard";
import { AppShell } from "../src/components/AppShell";
import { MetricCard } from "../src/components/MetricCard";
import { useAuthStore, UserRole } from "../src/stores/auth.store";
import { useUiStore } from "../src/stores/ui.store";
import { colors, radius, shadows, spacing, typography } from "../src/theme";

type HomeMetric = {
  label: string;
  value: string;
};

type HomeContent = {
  title: string;
  description: string;
  nextAction: string;
  metrics: HomeMetric[];
};

function getHomeContent(role: UserRole): HomeContent {
  if (role === "GESTOR") {
    return {
      title: "Visao do gestor",
      description: "Acompanhe apenas os empreendimentos atribuidos ao seu perfil.",
      nextAction:
        "Priorize as conversas sem responsavel e mantenha o ritmo comercial da equipe.",
      metrics: [
        { label: "Leads nos empreendimentos", value: "41" },
        { label: "Conversas sem responsavel", value: "6" },
        { label: "Visitas hoje", value: "5" },
        { label: "Corretores ativos", value: "8" },
      ],
    };
  }

  if (role === "ADM") {
    return {
      title: "Painel administrativo",
      description: "Visao completa para governanca e performance da operacao.",
      nextAction:
        "Monitore os indicadores criticos e use o menu administrativo para ajustes rapidos.",
      metrics: [
        { label: "Empreendimentos", value: "4" },
        { label: "Leads abertos", value: "130" },
        { label: "Conversas totais", value: "820" },
        { label: "Usuarios", value: "24" },
      ],
    };
  }

  return {
    title: "Bom trabalho hoje",
    description: "Seu painel destaca conversas e visitas que pedem acao imediata.",
    nextAction:
      "Atenda os leads prioritarios e acompanhe os casos que ja precisam de atendimento humano.",
    metrics: [
      { label: "Conversas aguardando", value: "3" },
      { label: "Visitas hoje", value: "2" },
      { label: "Precisa de humano", value: "1" },
      { label: "Leads ativos", value: "12" },
    ],
  };
}

export default function HomeScreen() {
  const user = useAuthStore((state) => state.user);
  const requestAdminMenu = useUiStore((state) => state.requestAdminMenu);
  const role = user?.role ?? "CORRETOR";
  const content = getHomeContent(role);

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <View style={styles.heroPill}>
            <Text style={styles.heroPillText}>NETIV</Text>
          </View>
          <Text style={styles.title}>{content.title}</Text>
          <Text style={styles.subtitle}>{user?.name ?? "Usuario"}</Text>
          <Text style={styles.description}>{content.description}</Text>
        </View>

        <View style={styles.grid}>
          {content.metrics.map((metric) => (
            <MetricCard key={metric.label} label={metric.label} value={metric.value} />
          ))}
        </View>

        <View style={styles.nextAction}>
          <Text style={styles.nextActionLabel}>Proxima acao</Text>
          <Text style={styles.nextActionText}>{content.nextAction}</Text>
        </View>

        <View style={styles.actionList}>
          <ActionCard
            title="Abrir conversas"
            description="Entrar na inbox e manter atendimento ativo."
            icon="message-processing-outline"
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
                title="Equipe"
                description="Acompanhar corretores vinculados."
                icon="account-group-outline"
                onPress={() => router.push("/equipe")}
              />
              <ActionCard
                title="Empreendimentos"
                description="Monitorar carteira sob sua gestao."
                icon="office-building-outline"
                onPress={() => router.push("/empreendimentos")}
              />
            </>
          ) : null}

          {role === "ADM" ? (
            <ActionCard
              title="Abrir menu administrativo"
              description="Acessar equipe, empreendimentos, templates e configuracoes."
              icon="shield-crown-outline"
              onPress={requestAdminMenu}
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
