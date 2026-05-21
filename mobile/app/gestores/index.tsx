import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";

const items = [
  "Gestor Évora",
  "Gestor Altis",
  "Gestor Geral",
];

export default function PageScreen() {
  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Gestores</Text>
        <Text style={styles.subtitle}>Área administrativa para acompanhamento de gestores.</Text>

        {items.map((item) => (
          <View key={item} style={styles.card}>
            <Text style={styles.cardTitle}>{item}</Text>
            <Text style={styles.cardText}>Dados simulados para validação da navegação mobile.</Text>
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
    fontWeight: "800",
    color: "#0F172A",
  },
  subtitle: {
    fontSize: 15,
    color: "#64748B",
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#0F172A",
  },
  cardText: {
    color: "#64748B",
    marginTop: 6,
  },
});