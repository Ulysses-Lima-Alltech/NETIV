import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const cards = [
  { label: "Conversas aguardando", value: "3" },
  { label: "Visitas hoje", value: "2" },
  { label: "Precisa de humano", value: "1" },
  { label: "Leads ativos", value: "12" },
];

export default function HomeScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Resumo</Text>
      <Text style={styles.subtitle}>Painel simples com os dados do usuário logado.</Text>

      <View style={styles.grid}>
        {cards.map((card) => (
          <View key={card.label} style={styles.card}>
            <Text style={styles.value}>{card.value}</Text>
            <Text style={styles.label}>{card.label}</Text>
          </View>
        ))}
      </View>

      <Pressable style={styles.action} onPress={() => router.push("/conversas")}>
        <Text style={styles.actionText}>Abrir conversas</Text>
      </Pressable>

      <Pressable style={styles.secondaryAction} onPress={() => router.push("/visitas")}>
        <Text style={styles.secondaryActionText}>Ver visitas</Text>
      </Pressable>

      <Pressable style={styles.secondaryAction} onPress={() => router.push("/perfil")}>
        <Text style={styles.secondaryActionText}>Meu perfil</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 18,
    gap: 14,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#0F172A",
  },
  subtitle: {
    fontSize: 15,
    color: "#64748B",
    marginBottom: 4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  card: {
    width: "47%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  value: {
    fontSize: 28,
    fontWeight: "900",
    color: "#0F172A",
  },
  label: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 4,
  },
  action: {
    backgroundColor: "#0F172A",
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 8,
  },
  actionText: {
    color: "#FFFFFF",
    textAlign: "center",
    fontWeight: "800",
    fontSize: 16,
  },
  secondaryAction: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 14,
    paddingVertical: 15,
  },
  secondaryActionText: {
    color: "#0F172A",
    textAlign: "center",
    fontWeight: "800",
    fontSize: 16,
  },
});
