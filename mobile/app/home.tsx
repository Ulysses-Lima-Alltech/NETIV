import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ActionCard } from "../src/components/ActionCard";
import { AppShell } from "../src/components/AppShell";
import { MetricCard } from "../src/components/MetricCard";
import { useAuthStore, UserRole } from "../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../src/theme";

type HomeMetric = {
  label: string;
  value: string;
};

function getHomeData(role: UserRole): {
  greeting: string;
  description: string;
  nextAction: string;
  metrics: HomeMetric[];
} {
  if (role === "GESTOR") {
    return {
      greeting: "Visão do gestor",
      description: "Você acompanha apenas os empreendimentos atribuídos ao seu perfil.",
      nextAction: "Priorize as conversas sem responsável para manter o ritmo comercial da equipe.",
      metrics: [
        { label: "Leads nos empreendimentos", value: "41" },
        { label: "Conversas sem responsável", value: "6" },
        { label: "Visitas hoje", value: "5" },
        { label: "Corretores ativos", value: "8" },
      ],
    };
  }

  if (role === "ADM") {
    return {
      greeting: "Painel administrativo",
      description: "Visão ampla da operação para decisões comerciais e de governança.",
      nextAction: "Monitore os indicadores críticos e abra o menu administrativo para ajustes.",
      metrics: [
        { label: "Empreendimentos", value: "4" },
        { label: "Leads abertos", value: "130" },
        { label: "Conversas totais", value: "820" },
        { label: "Usuários", value: "24" },
      ],
    };
  }

  return {
    greeting: "Bom trabalho hoje",
    description: "Seu painel mostra as conversas e visitas que exigem ação rápida.",
    nextAction: "Responda os leads prioritários e acompanhe os atendimentos que precisam de humano.",
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
  const role = user?.role ?? "CORRETOR";
  const content = getHomeData(role);

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <View style={styles.heroPill}>
            <Text style={styles.heroPillText}>NETIV Mobile</Text>
          </View>
          <Text style={styles.title}>{content.greeting}</Text>
          <Text style={styles.subtitle}>{user?.name ?? "Usuário"}</Text>
          <Text style={styles.description}>{content.description}</Text>
        </View>

        <View style={styles.grid}>
          {content.metrics.map((metric) => (
            <MetricCard key={metric.label} label={metric.label} value={metric.value} />
          ))}
        </View>

        <View style={styles.nextAction}>
          <Text style={styles.nextActionLabel}>Próxima ação</Text>
          <Text style={styles.nextActionText}>{content.nextAction}</Text>
        </View>

        <View style={styles.actionList}>
          <ActionCard
            title="Abrir conversas"
            description="Acessar inbox e responder clientes."
            icon="message-processing-outline"
            onPress={() => router.push("/conversas")}
            variant="primary"
          />

          {role === "CORRETOR" ? (
            <ActionCard
              title="Ver visitas"
              description="Conferir agenda e status dos atendimentos."
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
                description="Monitorar carteira atribuída."
                icon="office-building-outline"
                onPress={() => router.push("/empreendimentos")}
              />
            </>
          ) : null}

          {role === "ADM" ? (
            <ActionCard
              title="Menu administrativo"
              description="Abrir equipe, empreendimentos, templates e configurações."
              icon="shield-crown-outline"
              onPress={() => router.push("/configuracoes")}
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
    fontSize: 30,
    lineHeight: 34,
  },
  subtitle: {
    ...typography.cardTitle,
    color: colors.text,
    marginTop: 2,
  },
  description: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
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
  },
  nextActionText: {
    ...typography.body,
    color: "#FFFFFF",
    marginTop: 4,
  },
  actionList: {
    gap: spacing.sm,
  },
});

