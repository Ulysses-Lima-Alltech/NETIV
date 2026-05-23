import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { EmptyState } from "../../src/components/EmptyState";
import { StatusBadge } from "../../src/components/StatusBadge";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";

const WEB_WHATSAPP_SECTIONS = ["Credenciais Meta", "Webhook", "Envio"];

export default function SettingsWhatsAppMobileScreen() {
  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Configuracoes - WhatsApp</Text>
        <Text style={styles.subtitle}>
          Esta opcao existe na web. No mobile, o backend de configuracao ainda nao esta exposto com contrato seguro.
        </Text>

        <View style={styles.card}>
          <StatusBadge label="Indisponivel no mobile" tone="warning" />
          <Text style={styles.cardTitle}>Secoes reais na web</Text>
          {WEB_WHATSAPP_SECTIONS.map((section) => (
            <Text key={section} style={styles.bulletLine}>
              {`\u2022 ${section}`}
            </Text>
          ))}
        </View>

        <EmptyState
          icon="message-text-outline"
          title="Edicao apenas na web"
          description="Use a versao web para alterar credenciais, webhook e parametros de envio."
        />
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
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadows.card,
  },
  cardTitle: {
    ...typography.cardTitle,
    color: colors.navy,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    fontSize: 14,
    lineHeight: 19,
  },
  bulletLine: {
    ...typography.body,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
});
