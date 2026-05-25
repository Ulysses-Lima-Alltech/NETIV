import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { ConversationCard } from "../../src/components/ConversationCard";
import { EmptyState } from "../../src/components/EmptyState";
import { getConversationsWithApi, getConversationStatusLabel } from "../../src/services/conversations.service";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";
import { Conversation, ConversationListType } from "../../src/types/conversation.types";

export default function ConversationsScreen() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const showAssignedBroker = user?.role === "GESTOR" || user?.role === "ADM";
  const [activeType, setActiveType] = useState<ConversationListType>("CLIENT");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let active = true;

    async function loadConversations() {
      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setErrorMessage(null);
      setConversations([]);

      if (!token) {
        if (active && requestId === requestIdRef.current) {
          setErrorMessage("Sessao sem token. Faca login novamente.");
          setIsLoading(false);
        }
        return;
      }

      try {
        const apiItems = await getConversationsWithApi(token, activeType);
        if (active && requestId === requestIdRef.current) {
          setConversations(apiItems);
        }
      } catch {
        if (active && requestId === requestIdRef.current) {
          setConversations([]);
          setErrorMessage("Nao foi possivel carregar conversas agora.");
        }
      }
    }

    loadConversations().finally(() => {
      if (active) {
        setIsLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [activeType, token]);

  return (
    <AppShell>
      <FlatList
        contentContainerStyle={styles.container}
        data={conversations}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.headerCard}>
            <Text style={styles.title}>Inbox de conversas</Text>
            <Text style={styles.subtitle}>
              {user?.role === "CORRETOR"
                ? "Leads atribuidos ao seu atendimento."
                : "Visao organizada das conversas conforme seu perfil."}
            </Text>
            {showAssignedBroker ? (
              <View style={styles.tabsWrap}>
                <Pressable
                  style={[styles.tabButton, activeType === "CLIENT" ? styles.tabButtonActive : null]}
                  onPress={() => setActiveType("CLIENT")}
                >
                  <Text style={[styles.tabText, activeType === "CLIENT" ? styles.tabTextActive : null]}>
                    Clientes
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.tabButton, activeType === "INTERNO" ? styles.tabButtonActive : null]}
                  onPress={() => setActiveType("INTERNO")}
                >
                  <Text style={[styles.tabText, activeType === "INTERNO" ? styles.tabTextActive : null]}>
                    Interno
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={colors.orange} />
              <Text style={styles.loadingText}>Carregando conversas</Text>
            </View>
          ) : (
            <EmptyState
              icon="message-processing-outline"
              title={activeType === "INTERNO" ? "Nenhuma conversa interna" : "Nenhuma conversa disponivel"}
              description={
                activeType === "INTERNO"
                  ? "Quando houver conversas internas dentro do seu acesso, elas aparecerao aqui."
                  : "Quando houver conversas de clientes dentro do seu acesso, elas aparecerao aqui."
              }
            />
          )
        }
        renderItem={({ item }) => (
          <ConversationCard
            clientName={item.clientName}
            enterpriseName={item.enterpriseName}
            lastMessage={item.lastMessage}
            anaStatus={getConversationStatusLabel(item.status)}
            needsHuman={item.needsHuman}
            assignedBrokerName={item.assignedBrokerName}
            showAssignedBroker={showAssignedBroker}
            unread={item.unread}
            onPress={() => router.push(`/conversas/${item.id}`)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  headerCard: {
    marginBottom: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.card,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.navy,
    fontSize: 22,
    lineHeight: 27,
  },
  subtitle: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 4,
  },
  tabsWrap: {
    marginTop: spacing.sm,
    flexDirection: "row",
    backgroundColor: colors.backgroundAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    minHeight: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tabButtonActive: {
    backgroundColor: colors.navy,
  },
  tabText: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: "700",
  },
  tabTextActive: {
    color: "#FFFFFF",
  },
  separator: {
    height: 8,
  },
  loadingCard: {
    marginTop: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    ...shadows.card,
  },
  loadingText: {
    ...typography.caption,
    color: colors.muted,
  },
  errorText: {
    ...typography.caption,
    marginTop: spacing.xs,
    color: colors.red,
    fontSize: 11,
    lineHeight: 15,
  },
});
