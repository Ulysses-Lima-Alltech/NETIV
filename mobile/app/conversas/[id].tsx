import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors } from "../../src/theme/brand";
import { useAuthStore } from "../../src/stores/auth.store";

const initialMessages = [
  { id: "1", from: "client", text: "Olá, tenho interesse no Évora." },
  { id: "2", from: "ana", text: "O Évora é um loteamento fechado em Atibaia. Me conta, quais são suas dúvidas?" },
];

export default function ConversationDetailScreen() {
  const { id } = useLocalSearchParams();
  const user = useAuthStore((state) => state.user);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState(initialMessages);
  const [handoff, setHandoff] = useState(false);

  function sendMessage() {
    if (!message.trim()) return;

    setMessages((current) => [
      ...current,
      { id: String(Date.now()), from: "me", text: message.trim() },
    ]);
    setMessage("");
  }

  function toggleHandoff() {
    setHandoff((current) => !current);
    Alert.alert(
      "Handoff atualizado",
      handoff ? "A conversa voltou para a Ana." : "A conversa foi marcada para atendimento humano."
    );
  }

  const canSeeDetails = user?.role === "GESTOR" || user?.role === "ADM";
  const isAdmin = user?.role === "ADM";

  return (
    <View style={styles.container}>
      <View style={styles.infoBox}>
        <View>
          <Text style={styles.infoTitle}>Conversa #{id}</Text>
          <Text style={styles.infoText}>
            Status: {handoff ? "Atendimento humano" : "Ana atendendo"}
          </Text>
        </View>

        <Pressable
          style={[styles.handoffButton, handoff ? styles.handoffButtonActive : null]}
          onPress={toggleHandoff}
        >
          <Text style={styles.handoffButtonText}>
            {handoff ? "Voltar Ana" : "Handoff"}
          </Text>
        </Pressable>
      </View>

      {canSeeDetails ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.detailsStrip}
        >
          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Lead</Text>
            <Text style={styles.detailValue}>Quente</Text>
          </View>
          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Empreendimento</Text>
            <Text style={styles.detailValue}>Évora</Text>
          </View>
          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Corretor</Text>
            <Text style={styles.detailValue}>Carlos</Text>
          </View>
          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Visita</Text>
            <Text style={styles.detailValue}>Agendada</Text>
          </View>
          {isAdmin ? (
            <View style={styles.detailCardAdmin}>
              <Text style={styles.detailLabelAdmin}>ADM</Text>
              <Text style={styles.detailValueAdmin}>Acesso total</Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}

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
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoTitle: {
    fontWeight: "900",
    color: colors.navy,
    fontSize: 16,
  },
  infoText: {
    color: colors.muted,
    marginTop: 2,
  },
  handoffButton: {
    backgroundColor: colors.orange,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  handoffButtonActive: {
    backgroundColor: colors.green,
  },
  handoffButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  detailsStrip: {
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.background,
  },
  detailCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    minWidth: 130,
  },
  detailLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  detailValue: {
    color: colors.navy,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
  },
  detailCardAdmin: {
    backgroundColor: colors.navy,
    borderRadius: 14,
    padding: 12,
    minWidth: 130,
  },
  detailLabelAdmin: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: "900",
  },
  detailValueAdmin: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
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
    backgroundColor: colors.navy,
  },
  theirs: {
    alignSelf: "flex-start",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mineText: {
    color: "#FFFFFF",
  },
  theirsText: {
    color: colors.navy,
  },
  composer: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
  },
  button: {
    backgroundColor: colors.orange,
    borderRadius: 14,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
});