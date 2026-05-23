import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { ConversationCard } from "../../src/components/ConversationCard";
import { EmptyState } from "../../src/components/EmptyState";
import {
  getConversationsByRole,
  getConversationsWithApi,
  getConversationStatusLabel,
} from "../../src/services/conversations.service";
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

  useEffect(() => {
    let active = true;

    async function loadConversations() {
      setIsLoading(true);

      try {
        if (token) {
          const apiItems = await getConversationsWithApi(token, activeType);
          if (active) {
            setConversations(apiItems);
          }
          return;
        }
      } catch {
        // fallback para mock quando API falhar
      }

      const fallbackItems = await getConversationsByRole(user);
      if (active) {
        setConversations(fallbackItems);
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
  }, [activeType, token, user]);

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
              title="Nenhuma conversa disponível"
              description="Quando houver conversas dentro do seu acesso, elas aparecerão aqui."
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
});
