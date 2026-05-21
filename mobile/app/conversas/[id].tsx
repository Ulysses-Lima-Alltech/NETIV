import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

const initialMessages = [
  { id: "1", from: "client", text: "Olá, tenho interesse no Évora." },
  { id: "2", from: "ana", text: "O Évora é um loteamento fechado em Atibaia. Me conta, quais são suas dúvidas?" },
];

export default function ConversationDetailScreen() {
  const { id } = useLocalSearchParams();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState(initialMessages);

  function sendMessage() {
    if (!message.trim()) return;

    setMessages((current) => [
      ...current,
      { id: String(Date.now()), from: "me", text: message.trim() },
    ]);
    setMessage("");
  }

  return (
    <View style={styles.container}>
      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>Conversa #{id}</Text>
        <Text style={styles.infoText}>Status: Ana atendendo</Text>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messages}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.from === "me" ? styles.mine : styles.theirs]}>
            <Text style={item.from === "me" ? styles.mineText : styles.theirsText}>{item.text}</Text>
          </View>
        )}
      />

      <View style={styles.composer}>
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="Digite sua resposta..."
          style={styles.input}
        />
        <Pressable style={styles.button} onPress={sendMessage}>
          <Text style={styles.buttonText}>Enviar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  infoBox: {
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    padding: 14,
  },
  infoTitle: {
    fontWeight: "900",
    color: "#0F172A",
    fontSize: 16,
  },
  infoText: {
    color: "#64748B",
    marginTop: 2,
  },
  messages: {
    padding: 14,
    gap: 10,
  },
  bubble: {
    maxWidth: "82%",
    borderRadius: 16,
    padding: 12,
  },
  mine: {
    alignSelf: "flex-end",
    backgroundColor: "#0F172A",
  },
  theirs: {
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  mineText: {
    color: "#FFFFFF",
  },
  theirsText: {
    color: "#0F172A",
  },
  composer: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: "#F8FAFC",
  },
  button: {
    backgroundColor: "#0F172A",
    borderRadius: 14,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
});