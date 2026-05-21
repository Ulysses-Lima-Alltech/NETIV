import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";

const conversations = [
  {
    id: "1",
    clientName: "Carlos Silva",
    enterpriseName: "Évora",
    lastMessage: "Gostaria de saber sobre os lotes disponíveis.",
    status: "Ana atendendo",
    unread: true,
  },
  {
    id: "2",
    clientName: "Mariana Costa",
    enterpriseName: "Évora",
    lastMessage: "Podemos agendar uma visita amanhã?",
    status: "Precisa humano",
    unread: false,
  },
];

export default function ConversationsScreen() {
  return (
    <AppShell>
      <FlatList
        contentContainerStyle={styles.container}
        data={conversations}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <>
            <Text style={styles.title}>Conversas</Text>
            <Text style={styles.subtitle}>Clientes atribuídos conforme seu perfil.</Text>
          </>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/conversas/${item.id}`)}>
            <View style={styles.row}>
              <Text style={styles.client}>{item.clientName}</Text>
              {item.unread ? <View style={styles.dot} /> : null}
            </View>
            <Text style={styles.enterprise}>{item.enterpriseName}</Text>
            <Text style={styles.message}>{item.lastMessage}</Text>
            <Text style={item.status === "Precisa humano" ? styles.statusWarning : styles.status}>
              {item.status}
            </Text>
          </Pressable>
        )}
      />
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  client: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0F172A",
  },
  enterprise: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 2,
  },
  message: {
    fontSize: 14,
    color: "#334155",
    marginTop: 10,
  },
  status: {
    marginTop: 12,
    color: "#2563EB",
    fontWeight: "800",
  },
  statusWarning: {
    marginTop: 12,
    color: "#DC2626",
    fontWeight: "800",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#22C55E",
  },
});