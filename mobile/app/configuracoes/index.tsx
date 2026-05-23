import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { AppIcon } from "../../src/components/AppIcon";
import { EmptyState } from "../../src/components/EmptyState";
import { StatusBadge } from "../../src/components/StatusBadge";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";

type WebConfigOption = {
  key: "whatsapp" | "api";
  title: string;
  description: string;
  path: "/configuracoes/whatsapp" | "/configuracoes/api";
  icon: "message-text-outline" | "cog-outline";
  webSections: string;
};

const WEB_CONFIG_OPTIONS: WebConfigOption[] = [
  {
    key: "whatsapp",
    title: "WhatsApp",
    description: "Credenciais Meta, webhook e parametros de envio.",
    path: "/configuracoes/whatsapp",
    icon: "message-text-outline",
    webSections: "Credenciais Meta, Webhook e Envio",
  },
  {
    key: "api",
    title: "Configuracao de API",
    description: "Config global, custos OpenAI e configuracao por empreendimento.",
    path: "/configuracoes/api",
    icon: "cog-outline",
    webSections: "Global padrao, Custos OpenAI e Por empreendimento",
  },
];

export default function SettingsScreen() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role ?? "CORRETOR";

  if (role !== "ADM") {
    return (
      <AppShell>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Configuracoes</Text>
          <EmptyState
            icon="shield-crown-outline"
            title="Acesso restrito"
            description="No momento, configuracoes estao disponiveis apenas para administradores."
          />
        </ScrollView>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Configuracoes</Text>
        <Text style={styles.subtitle}>
          Opcoes reais mapeadas da web. Ajustes seguem indisponiveis no mobile ate existir suporte mobile-safe.
        </Text>

        <View style={styles.list}>
          {WEB_CONFIG_OPTIONS.map((item) => (
            <Pressable key={item.key} style={styles.card} onPress={() => router.push(item.path)}>
              <View style={styles.cardTop}>
                <View style={styles.iconWrap}>
                  <AppIcon name={item.icon} size={18} color={colors.navy} />
                </View>
                <StatusBadge label="Indisponivel no mobile" tone="warning" />
              </View>

              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDescription}>{item.description}</Text>
              <Text style={styles.cardFootnote}>Web: {item.webSections}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.navy,
    fontSize: 24,
    lineHeight: 29,
  },
  subtitle: {
    ...typography.body,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.card,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    ...typography.cardTitle,
    color: colors.navy,
    marginTop: spacing.xs,
    fontSize: 15,
    lineHeight: 20,
  },
  cardDescription: {
    ...typography.body,
    color: colors.text,
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
  },
  cardFootnote: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
    fontSize: 11,
    lineHeight: 15,
  },
});
