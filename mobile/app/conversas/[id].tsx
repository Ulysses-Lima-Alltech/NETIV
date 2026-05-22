import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { StatusBadge } from "../../src/components/StatusBadge";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, spacing, typography } from "../../src/theme";

type Message = {
  id: string;
  from: "cliente" | "ana" | "eu";
  text: string;
};

const initialMessages: Message[] = [
  { id: "1", from: "cliente", text: "Olá, tenho interesse no Évora." },
  {
    id: "2",
    from: "ana",
    text: "Perfeito! Posso te mostrar opções de pagamento e agendar uma visita.",
  },
];

const detailRows = [
  { label: "Lead", value: "Quente" },
  { label: "Empreendimento", value: "Évora" },
  { label: "Corretor", value: "João Corretor" },
  { label: "Visita", value: "Hoje, 16:00" },
];

function parseConversationId(rawId: string | string[] | undefined) {
  if (Array.isArray(rawId)) return rawId[0] ?? "-";
  return rawId ?? "-";
}

export default function ConversationDetailScreen() {
  const { id } = useLocalSearchParams();
  const user = useAuthStore((state) => state.user);
  const [messages, setMessages] = useState(initialMessages);
  const [message, setMessage] = useState("");
  const [handoff, setHandoff] = useState(false);

  const role = user?.role ?? "CORRETOR";
  const canSeeOperationalDetails = role === "GESTOR" || role === "ADM";
  const conversationId = parseConversationId(id);
  const statusLabel = handoff ? "Atendimento humano" : "Ana atendendo";
  const handoffButtonLabel = handoff ? "Voltar para Ana" : "Ativar handoff";
  const handoffTone = handoff ? "danger" : "info";

  const detailData = useMemo(
    () => [...detailRows, { label: "Status", value: statusLabel }],
    [statusLabel]
  );

  function sendMessage() {
    if (!message.trim()) return;

    setMessages((current) => [
      ...current,
      { id: `${Date.now()}`, from: "eu", text: message.trim() },
    ]);
    setMessage("");
  }

  function toggleHandoff() {
    setHandoff((current) => !current);
  }

  return (
    <AppShell>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <View style={styles.topPanel}>
          <View style={styles.topTitleRow}>
            <View style={styles.topTextBlock}>
              <Text style={styles.topTitle}>Conversa #{conversationId}</Text>
              <Text style={styles.topSubtitle}>Cliente: Carlos Silva · Évora</Text>
            </View>
            <StatusBadge label={statusLabel} tone={handoffTone} />
          </View>

          <Pressable
            style={[styles.handoffButton, handoff ? styles.handoffButtonDanger : null]}
            onPress={toggleHandoff}
          >
            <MaterialCommunityIcons name="account-switch-outline" size={16} color="#FFFFFF" />
            <Text style={styles.handoffButtonText}>{handoffButtonLabel}</Text>
          </Pressable>
        </View>

        {canSeeOperationalDetails ? (
          <View style={styles.detailsPanel}>
            <View style={styles.detailsHeaderRow}>
              <Text style={styles.detailsTitle}>Detalhes comerciais e operacionais</Text>
              {role === "ADM" ? <StatusBadge label="Acesso total" tone="inverse" /> : null}
            </View>
            <View style={styles.detailsGrid}>
              {detailData.map((item) => (
                <View key={item.label} style={styles.detailCard}>
                  <Text style={styles.detailLabel}>{item.label}</Text>
                  <Text style={styles.detailValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messages}
          renderItem={({ item }) => {
            const mine = item.from === "eu";

            return (
              <View style={[styles.messageBubble, mine ? styles.messageMine : styles.messageTheirs]}>
                <Text style={[styles.messageText, mine ? styles.messageTextMine : null]}>
                  {item.text}
                </Text>
              </View>
            );
          }}
        />

        <View style={styles.composer}>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Digite sua resposta..."
            placeholderTextColor="#98A2B3"
            style={styles.input}
          />
          <Pressable style={styles.sendButton} onPress={sendMessage}>
            <MaterialCommunityIcons name="send" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topPanel: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 6,
  },
  topTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  topTextBlock: {
    flex: 1,
  },
  topTitle: {
    ...typography.sectionTitle,
    fontSize: 17,
    lineHeight: 22,
    color: colors.navy,
  },
  topSubtitle: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 14,
    color: colors.muted,
    marginTop: 1,
  },
  handoffButton: {
    minHeight: 34,
    borderRadius: radius.md,
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
  },
  handoffButtonDanger: {
    backgroundColor: colors.red,
  },
  handoffButtonText: {
    ...typography.caption,
    color: "#FFFFFF",
  },
  detailsPanel: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    gap: 6,
  },
  detailsHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  detailsTitle: {
    ...typography.cardTitle,
    color: colors.navy,
    flex: 1,
  },
  detailsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  detailCard: {
    width: "48%",
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  detailLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  detailValue: {
    ...typography.body,
    color: colors.text,
    marginTop: 2,
  },
  messages: {
    padding: spacing.sm,
    gap: 6,
    paddingBottom: spacing.lg,
  },
  messageBubble: {
    maxWidth: "82%",
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
  },
  messageMine: {
    alignSelf: "flex-end",
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  messageTheirs: {
    alignSelf: "flex-start",
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  messageText: {
    ...typography.body,
    color: colors.text,
  },
  messageTextMine: {
    color: "#FFFFFF",
  },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FBFDFF",
    paddingHorizontal: spacing.sm,
    color: colors.text,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
  },
});

