import { FlatList, StyleSheet, Text, View } from "react-native";

const visits = [
  { id: "1", time: "14:30", clientName: "Carlos Silva", enterpriseName: "Évora", status: "Confirmada" },
  { id: "2", time: "16:00", clientName: "Mariana Costa", enterpriseName: "Évora", status: "Agendada" },
];

export default function VisitsScreen() {
  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={visits}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <>
          <Text style={styles.title}>Visitas</Text>
          <Text style={styles.subtitle}>Agenda conforme seu perfil de acesso.</Text>
        </>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.time}>{item.time}</Text>
          <Text style={styles.client}>{item.clientName}</Text>
          <Text style={styles.enterprise}>{item.enterpriseName}</Text>
          <Text style={styles.status}>{item.status}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 18,
    gap: 12,
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
  time: {
    fontSize: 22,
    fontWeight: "900",
    color: "#0F172A",
  },
  client: {
    fontSize: 16,
    fontWeight: "800",
    color: "#334155",
    marginTop: 8,
  },
  enterprise: {
    color: "#64748B",
    marginTop: 2,
  },
  status: {
    color: "#2563EB",
    fontWeight: "800",
    marginTop: 10,
  },
});