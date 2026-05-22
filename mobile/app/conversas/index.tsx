import { router } from "expo-router";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { ConversationCard } from "../../src/components/ConversationCard";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, spacing, typography } from "../../src/theme";

const conversations = [
  {
    id: "1",
    clientName: "Carlos Silva",
    enterpriseName: "Évora",
    lastMessage: "Gostaria de saber sobre as unidades com entrada facilitada.",
    anaStatus: "Ana atendendo" as const,
    needsHuman: false,
    unread: true,
  },
  {
    id: "2",
    clientName: "Mariana Costa",
    enterpriseName: "Évora",
    lastMessage: "Podemos agendar uma visita amanhã no fim da tarde?",
    anaStatus: "Atendimento humano" as const,
    needsHuman: true,
    unread: false,
  },
  {
    id: "3",
    clientName: "Rafael Gomes",
    enterpriseName: "Montaresa",
    lastMessage: "Recebi a proposta e quero validar a tabela final.",
    anaStatus: "Ana atendendo" as const,
    needsHuman: false,
    unread: false,
  },
];

export default function ConversationsScreen() {
  const user = useAuthStore((state) => state.user);

  return (
    <AppShell>
      <FlatList
        contentContainerStyle={styles.container}
        data={conversations}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Inbox de conversas</Text>
            <Text style={styles.subtitle}>
              {user?.role === "CORRETOR"
                ? "Leads atribuídos ao seu atendimento."
                : "Conversas exibidas conforme o escopo do seu perfil."}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <ConversationCard
            clientName={item.clientName}
            enterpriseName={item.enterpriseName}
            lastMessage={item.lastMessage}
            anaStatus={item.anaStatus}
            needsHuman={item.needsHuman}
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
    paddingVertical: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  header: {
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.navy,
    fontSize: 26,
    lineHeight: 31,
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

