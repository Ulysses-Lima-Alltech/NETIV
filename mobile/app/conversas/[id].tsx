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
import {
  getConversationDetailById,
  getConversationStatusLabel,
  sendMockMessage,
  toggleMockHandoff,
} from "../../src/services/conversations.service";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";
import { ConversationDetail } from "../../src/types/conversation.types";

const INITIAL_CONVERSATION_DETAIL: ConversationDetail = {
  conversation: {
    id: "-",
    clientName: "Cliente",
    enterpriseName: "Empreendimento",
    lastMessage: "Sem mensagem recente.",
    status: "ANA",
    needsHuman: false,
    unread: false,
    assignedBrokerName: "Corretor",
  },
  messages: [],
  commercialDetails: {
    leadTemperature: "Em analise",
    enterpriseName: "Empreendimento",
    brokerName: "Corretor",
    visitInfo: "Sem agenda",
    statusLabel: "Ana atendendo",
  },
};

function parseConversationId(rawId: string | string[] | undefined) {
  if (Array.isArray(rawId)) return rawId[0] ?? "-";
  return rawId ?? "-";
}

export default function ConversationDetailScreen() {
  const { id } = useLocalSearchParams();
  const user = useAuthStore((state) => state.user);
  const [detail, setDetail] = useState<ConversationDetail>(INITIAL_CONVERSATION_DETAIL);
  const [message, setMessage] = useState("");
  const [handoff, setHandoff] = useState(false);

  const role = user?.role ?? "CORRETOR";
  const canSeeOperationalDetails = role === "GESTOR" || role === "ADM";
  const canManageHandoff = role === "CORRETOR";
  const conversationId = parseConversationId(id);

  useEffect(() => {
    let active = true;

    getConversationDetailById(conversationId, user).then((conversationDetail) => {
      if (!active) return;

      setDetail(conversationDetail);
      setHandoff(conversationDetail.conversation.status === "HUMAN");
    });

    return () => {
      active = false;
    };
  }, [conversationId, user]);

  const statusLabel = handoff ? "Atendimento humano" : "Ana atendendo";
  const handoffButtonLabel = handoff ? "Voltar para Ana" : "Ativar handoff";
  const shouldShowHumanAssignment = canSeeOperationalDetails && (handoff || detail.conversation.needsHuman);

  const detailRows = useMemo(
    () => [
      { label: "Lead", value: detail.commercialDetails.leadTemperature },
      { label: "Empreendimento", value: detail.commercialDetails.enterpriseName },
      { label: "Corretor", value: detail.commercialDetails.brokerName },
      { label: "Visita", value: detail.commercialDetails.visitInfo },
      { label: "Status", value: statusLabel },
    ],
    [
      detail.commercialDetails.brokerName,
      detail.commercialDetails.enterpriseName,
      detail.commercialDetails.leadTemperature,
      detail.commercialDetails.visitInfo,
      statusLabel,
    ]
  );

  async function handleSendMessage() {
    if (!message.trim()) return;

    const sentMessage = await sendMockMessage(conversationId, message);
    if (!sentMessage) return;

    setDetail((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        lastMessage: sentMessage.text,
        unread: false,
      },
      messages: [...current.messages, sentMessage],
    }));

    setMessage("");
  }

  async function handleToggleHandoff() {
    const updatedConversation = await toggleMockHandoff(conversationId);

    if (!updatedConversation) {
      setHandoff((current) => !current);
      return;
    }

    setHandoff(updatedConversation.status === "HUMAN");
    setDetail((current) => ({
      ...current,
      conversation: updatedConversation,
      commercialDetails: {
        ...current.commercialDetails,
        statusLabel: getConversationStatusLabel(updatedConversation.status),
      },
    }));
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
              <Text style={styles.topSubtitle}>
                {`${detail.conversation.clientName} - ${detail.conversation.enterpriseName}`}
              </Text>
            </View>
            <StatusBadge label={statusLabel} tone={handoff ? "danger" : "info"} />
          </View>

          {canManageHandoff ? (
            <Pressable
              style={[styles.handoffButton, handoff ? styles.handoffButtonDanger : null]}
              onPress={handleToggleHandoff}
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
                      {`Atribuida para ${detail.conversation.assignedBrokerName}`}
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
              data={detail.messages}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.messagesContent}
              renderItem={({ item }) => {
                const mine = item.from === "me";

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
          <Pressable style={styles.sendButton} onPress={handleSendMessage}>
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
