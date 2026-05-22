import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { colors } from "../../src/theme/brand";
import { useAuthStore } from "../../src/stores/auth.store";

const team = [
  { name: "João Corretor", role: "CORRETOR", detail: "Évora" },
  { name: "Mariana Corretora", role: "CORRETOR", detail: "Évora" },
  { name: "Gestor Évora", role: "GESTOR", detail: "Responsável pelo Évora" },
  { name: "Administrador", role: "ADM", detail: "Acesso total" },
];

export default function TeamScreen() {
  const user = useAuthStore((state) => state.user);

  const visibleTeam =
    user?.role === "GESTOR"
      ? team.filter((item) => item.role === "CORRETOR")
      : team;

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>
          {user?.role === "GESTOR" ? "Equipe" : "Equipe e usuários"}
        </Text>

        <Text style={styles.subtitle}>
          {user?.role === "GESTOR"
            ? "Corretores vinculados aos empreendimentos sob sua responsabilidade."
            : "Corretores, gestores e administradores da operação."}
        </Text>

        {visibleTeam.map((item) => (
          <View key={`${item.role}-${item.name}`} style={styles.card}>
            <View style={styles.info}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.detail}>{item.detail}</Text>
            </View>

            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.role}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 18,
    gap: 12,
    paddingBottom: 28,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: colors.navy,
  },
  subtitle: {
    fontSize: 15,
    color: colors.muted,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.text,
  },
  detail: {
    color: colors.muted,
    marginTop: 4,
  },
  badge: {
    backgroundColor: colors.navy,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
  },
});