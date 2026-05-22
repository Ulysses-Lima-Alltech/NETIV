import { router } from "expo-router";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { ConversationCard } from "../../src/components/ConversationCard";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";

const conversations = [
  {
    id: "1",
    clientName: "Carlos Silva",
    enterpriseName: "Evora",
    lastMessage: "Quero entender as condicoes de entrada para fechar ainda hoje.",
    anaStatus: "Ana atendendo" as const,
    needsHuman: false,
    assignedBrokerName: "Joao Corretor",
    unread: true,
  },
  {
    id: "2",
    clientName: "Mariana Costa",
    enterpriseName: "Evora",
    lastMessage: "Podemos confirmar a visita para amanha no fim da tarde?",
    anaStatus: "Atendimento humano" as const,
    needsHuman: true,
    assignedBrokerName: "Mariana Corretora",
    unread: false,
  },
  {
    id: "3",
    clientName: "Rafael Gomes",
    enterpriseName: "Montaresa",
    lastMessage: "Recebi a proposta e preciso validar a tabela final com minha familia.",
    anaStatus: "Ana atendendo" as const,
    needsHuman: false,
    assignedBrokerName: "Lucas Corretor",
    unread: false,
  },
  {
    id: "4",
    clientName: "Aline Souza",
    enterpriseName: "Altis",
    lastMessage: "Tenho interesse no financiamento e queria os proximos passos.",
    anaStatus: "Atendimento humano" as const,
    needsHuman: false,
    assignedBrokerName: "Joao Corretor",
    unread: true,
  },
];

export default function ConversationsScreen() {
  const user = useAuthStore((state) => state.user);
  const showAssignedBroker = user?.role === "GESTOR" || user?.role === "ADM";

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
            anaStatus={item.anaStatus}
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
