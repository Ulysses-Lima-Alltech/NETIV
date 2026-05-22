import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { ConversationCard } from "../../src/components/ConversationCard";
import {
  getConversationsByRole,
  getConversationStatusLabel,
} from "../../src/services/conversations.service";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";
import { Conversation } from "../../src/types/conversation.types";

export default function ConversationsScreen() {
  const user = useAuthStore((state) => state.user);
  const showAssignedBroker = user?.role === "GESTOR" || user?.role === "ADM";
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    let active = true;

    getConversationsByRole(user).then((items) => {
      if (active) {
        setConversations(items);
      }
    });

    return () => {
      active = false;
    };
  }, [user]);

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
          </View>
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
  separator: {
    height: 8,
  },
});
