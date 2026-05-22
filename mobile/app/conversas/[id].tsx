import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
import { AppIcon } from "../../src/components/AppIcon";
import { AppShell } from "../../src/components/AppShell";
import { StatusBadge } from "../../src/components/StatusBadge";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";

type Message = {
  id: string;
  from: "cliente" | "ana" | "eu";
  text: string;
};

type ConversationMock = {
  id: string;
  clientName: string;
  enterpriseName: string;
  lead: string;
  assignedBrokerName: string;
  visitLabel: string;
  anaStatus: "Ana atendendo" | "Atendimento humano";
  needsHuman: boolean;
};

const initialMessages: Message[] = [
  { id: "1", from: "cliente", text: "Ola, tenho interesse no Evora." },
  {
    id: "2",
    from: "ana",
    text: "Perfeito. Posso mostrar as opcoes de pagamento e agendar uma visita ainda hoje.",
  },
];

const conversationMocks: Record<string, ConversationMock> = {
  "1": {
    id: "1",
    clientName: "Carlos Silva",
    enterpriseName: "Evora",
    lead: "Quente",
    assignedBrokerName: "Joao Corretor",
    visitLabel: "Hoje, 16:00",
    anaStatus: "Ana atendendo",
    needsHuman: false,
  },
  "2": {
    id: "2",
    clientName: "Mariana Costa",
    enterpriseName: "Evora",
    lead: "Quente",
    assignedBrokerName: "Mariana Corretora",
    visitLabel: "Amanha, 17:30",
    anaStatus: "Atendimento humano",
    needsHuman: true,
  },
  "3": {
    id: "3",
    clientName: "Rafael Gomes",
    enterpriseName: "Montaresa",
    lead: "Em negociacao",
    assignedBrokerName: "Lucas Corretor",
    visitLabel: "Sexta, 11:00",
    anaStatus: "Ana atendendo",
    needsHuman: false,
  },
  "4": {
    id: "4",
    clientName: "Aline Souza",
    enterpriseName: "Altis",
    lead: "Quente",
    assignedBrokerName: "Joao Corretor",
    visitLabel: "Sem visita",
    anaStatus: "Atendimento humano",
    needsHuman: false,
  },
};

const fallbackConversation: ConversationMock = {
  id: "-",
  clientName: "Cliente",
  enterpriseName: "Empreendimento",
  lead: "Em analise",
  assignedBrokerName: "Corretor",
  visitLabel: "Sem agenda",
  anaStatus: "Ana atendendo",
  needsHuman: false,
};

function parseConversationId(rawId: string | string[] | undefined) {
  if (Array.isArray(rawId)) return rawId[0] ?? "-";
  return rawId ?? "-";
}

function getConversationMock(conversationId: string) {
  return conversationMocks[conversationId] ?? { ...fallbackConversation, id: conversationId };
}

export default function ConversationDetailScreen() {
  const { id } = useLocalSearchParams();
  const user = useAuthStore((state) => state.user);
  const [messages, setMessages] = useState(initialMessages);
  const [message, setMessage] = useState("");

  const role = user?.role ?? "CORRETOR";
  const canSeeOperationalDetails = role === "GESTOR" || role === "ADM";
  const canManageHandoff = role === "CORRETOR";
  const conversationId = parseConversationId(id);
  const conversation = useMemo(() => getConversationMock(conversationId), [conversationId]);
  const [handoff, setHandoff] = useState(conversation.anaStatus === "Atendimento humano");

  useEffect(() => {
    setHandoff(conversation.anaStatus === "Atendimento humano");
  }, [conversation.anaStatus]);

  const statusLabel = handoff ? "Atendimento humano" : "Ana atendendo";
  const handoffButtonLabel = handoff ? "Voltar para Ana" : "Ativar handoff";
  const shouldShowHumanAssignment = canSeeOperationalDetails && (handoff || conversation.needsHuman);

  const detailRows = useMemo(
    () => [
      { label: "Lead", value: conversation.lead },
      { label: "Empreendimento", value: conversation.enterpriseName },
      { label: "Corretor", value: conversation.assignedBrokerName },
      { label: "Visita", value: conversation.visitLabel },
      { label: "Status", value: statusLabel },
    ],
    [conversation.assignedBrokerName, conversation.enterpriseName, conversation.lead, conversation.visitLabel, statusLabel]
  );

  function sendMessage() {
    if (!message.trim()) return;

    setMessages((current) => [...current, { id: `${Date.now()}`, from: "eu", text: message.trim() }]);
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
          <View style={styles.topRow}>
            <View style={styles.topTextBlock}>
              <Text style={styles.topTitle}>Conversa #{conversationId}</Text>
              <Text style={styles.topSubtitle}>{`${conversation.clientName} - ${conversation.enterpriseName}`}</Text>
            </View>
            <StatusBadge label={statusLabel} tone={handoff ? "danger" : "info"} />
          </View>

          {canManageHandoff ? (
            <Pressable
              style={[styles.handoffButton, handoff ? styles.handoffButtonDanger : null]}
              onPress={toggleHandoff}
            >
              <AppIcon name="account-switch-outline" size={14} color="#FFFFFF" />
              <Text style={styles.handoffButtonText}>{handoffButtonLabel}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.content}>
          {canSeeOperationalDetails ? (
            <View style={styles.detailsSection}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Detalhes comerciais e operacionais</Text>
                {role === "ADM" ? <StatusBadge label="Acesso total" tone="inverse" /> : null}
              </View>

              <View style={styles.detailsPanel}>
                <View style={styles.detailsGrid}>
                  {detailRows.map((item) => (
                    <View key={item.label} style={styles.detailCard}>
                      <Text style={styles.detailLabel}>{item.label}</Text>
                      <Text style={styles.detailValue}>{item.value}</Text>
                    </View>
                  ))}
                </View>

                {shouldShowHumanAssignment ? (
                  <View style={styles.assignmentBanner}>
                    <Text numberOfLines={1} style={styles.assignmentText}>
                      {`Atribuida para ${conversation.assignedBrokerName}`}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={styles.messagesSection}>
            <View style={styles.messagesHeader}>
              <Text style={styles.messagesTitle}>Mensagens</Text>
            </View>

            <FlatList
              style={styles.messagesList}
              data={messages}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.messagesContent}
              renderItem={({ item }) => {
                const mine = item.from === "eu";

                return (
                  <View style={[styles.messageBubble, mine ? styles.messageMine : styles.messageTheirs]}>
                    <Text style={[styles.messageText, mine ? styles.messageTextMine : null]}>{item.text}</Text>
                  </View>
                );
              }}
            />
          </View>
        </View>

        <View style={styles.composer}>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Digite sua resposta"
            placeholderTextColor="#98A2B3"
            style={styles.input}
          />
          <Pressable style={styles.sendButton} onPress={sendMessage}>
            <AppIcon name="send" size={15} color="#FFFFFF" />
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
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    gap: 7,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    alignItems: "center",
  },
  topTextBlock: {
    flex: 1,
  },
  topTitle: {
    ...typography.cardTitle,
    fontSize: 16,
    lineHeight: 21,
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
    fontSize: 11,
  },
  content: {
    flex: 1,
  },
  detailsSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.xs,
  },
  sectionTitle: {
    ...typography.cardTitle,
    color: colors.navy,
    fontSize: 14,
    lineHeight: 19,
    flex: 1,
  },
  detailsPanel: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.xs,
    ...shadows.card,
  },
  detailsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  detailCard: {
    width: "48%",
    backgroundColor: colors.backgroundAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  detailLabel: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 10,
    lineHeight: 13,
  },
  detailValue: {
    ...typography.body,
    color: colors.text,
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
  },
  assignmentBanner: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#FFD7BC",
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  assignmentText: {
    ...typography.caption,
    color: colors.navy,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "700",
  },
  messagesSection: {
    flex: 1,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  messagesHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  messagesTitle: {
    ...typography.cardTitle,
    color: colors.navy,
    fontSize: 14,
    lineHeight: 19,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
    gap: 6,
  },
  messageBubble: {
    maxWidth: "84%",
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
    fontSize: 13,
    lineHeight: 18,
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
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FBFDFF",
    paddingHorizontal: spacing.sm,
    color: colors.text,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
  },
});
