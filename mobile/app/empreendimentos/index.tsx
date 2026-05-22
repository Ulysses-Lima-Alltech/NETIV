import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { StatusBadge } from "../../src/components/StatusBadge";
import { getEnterprisesByRole } from "../../src/services/enterprises.service";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";
import { Enterprise } from "../../src/types/enterprise.types";

export default function EnterprisesScreen() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role ?? "CORRETOR";
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);

  useEffect(() => {
    let active = true;

    getEnterprisesByRole(user).then((items) => {
      if (active) {
        setEnterprises(items);
      }
    });

    return () => {
      active = false;
    };
  }, [user]);

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Empreendimentos</Text>
        <Text style={styles.subtitle}>
          {role === "GESTOR"
            ? "Voce visualiza somente os empreendimentos atribuidos ao seu perfil."
            : "Visao consolidada dos empreendimentos da operacao."}
        </Text>

        <View style={styles.list}>
          {enterprises.map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.name}>{item.name}</Text>
                <StatusBadge label={item.active ? "Ativo" : "Inativo"} tone={item.active ? "success" : "warning"} />
              </View>
              <Text style={styles.owner}>Cidade: {item.city}</Text>
            </View>
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
    marginTop: spacing.xs,
    fontSize: 13,
    lineHeight: 18,
  },
  list: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  name: {
    ...typography.cardTitle,
    color: colors.navy,
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
  },
  owner: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
    fontSize: 11,
    lineHeight: 15,
  },
});
