import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { EmptyState } from "../../src/components/EmptyState";
import { StatusBadge } from "../../src/components/StatusBadge";
import {
  addMockEnterpriseToMember,
  getEnterpriseLink,
  getTeamByRole,
  toggleMockTeamMemberActive,
  updateMockTeamMember,
} from "../../src/services/team.service";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";
import { TeamMember } from "../../src/types/team.types";

export default function TeamScreen() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role ?? "CORRETOR";
  const [team, setTeam] = useState<TeamMember[]>([]);

  useEffect(() => {
    let active = true;

    getTeamByRole(user).then((items) => {
      if (active) {
        setTeam(items);
      }
    });

    return () => {
      active = false;
    };
  }, [user]);

  function mergeUpdatedMember(updatedMember: TeamMember | null) {
    if (!updatedMember) return;

    setTeam((current) =>
      current.map((member) => (member.id === updatedMember.id ? updatedMember : member))
    );
  }

  async function handleEdit(memberId: string) {
    const updatedMember = await updateMockTeamMember(memberId);
    mergeUpdatedMember(updatedMember);
    Alert.alert("Edicao mockada", "Nome e telefone atualizados localmente.");
  }

  async function handleToggleActive(memberId: string) {
    const updatedMember = await toggleMockTeamMemberActive(memberId);
    mergeUpdatedMember(updatedMember);
  }

  async function handleAddEnterprise(memberId: string) {
    const updatedMember = await addMockEnterpriseToMember(memberId);
    mergeUpdatedMember(updatedMember);
    Alert.alert("Vinculo adicionado", "Empreendimento vinculado ao corretor no mock local.");
  }

  if (role === "CORRETOR") {
    return (
      <AppShell>
        <View style={styles.restrictedWrap}>
          <EmptyState
            icon="account-multiple-outline"
            title="Acesso restrito"
            description="A area de equipe e usuarios esta disponivel apenas para gestores e administradores."
          />
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>{role === "ADM" ? "Equipe e usuarios" : "Equipe"}</Text>
        <Text style={styles.subtitle}>
          {role === "ADM"
            ? "Acesso completo a corretores, gestores e administradores."
            : "Corretores vinculados aos empreendimentos sob sua gestao."}
        </Text>

        <View style={styles.list}>
          {team.map((member) => {
            const isAdminView = role === "ADM";

            return (
              <View key={member.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.nameWrap}>
                    <Text style={styles.name}>{member.name}</Text>
                    <Text style={styles.phone}>{member.phone}</Text>
                  </View>
                  <View style={styles.headerBadges}>
                    <StatusBadge
                      label={member.role}
                      tone={
                        member.role === "ADM" ? "inverse" : member.role === "GESTOR" ? "warning" : "info"
                      }
                    />
                    <StatusBadge
                      label={member.active ? "Ativo" : "Inativo"}
                      tone={member.active ? "success" : "warning"}
                    />
                  </View>
                </View>

                <View style={styles.enterpriseList}>
                  {member.enterprises.map((enterprise) => {
                    const enterpriseLink = getEnterpriseLink(enterprise, role);
                    const tone = enterpriseLink.manageable ? "success" : "neutral";

                    return (
                      <View key={`${member.id}-${enterprise}`} style={styles.enterpriseRow}>
                        <Text style={styles.enterpriseName}>{enterpriseLink.enterpriseName}</Text>
                        <StatusBadge label={enterpriseLink.label ?? "Sem status"} tone={tone} />
                      </View>
                    );
                  })}
                </View>

                <View style={styles.actionsRow}>
                  <Pressable style={styles.actionButton} onPress={() => handleEdit(member.id)}>
                    <Text style={styles.actionButtonText}>Editar</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.actionButton, styles.actionButtonSecondary]}
                    onPress={() => handleToggleActive(member.id)}
                  >
                    <Text style={[styles.actionButtonText, styles.actionButtonTextSecondary]}>
                      {member.active ? "Inativar" : "Ativar"}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[styles.actionButton, styles.actionButtonOutline]}
                    onPress={() => handleAddEnterprise(member.id)}
                  >
                    <Text style={[styles.actionButtonText, styles.actionButtonTextOutline]}>
                      Adicionar empreendimento
                    </Text>
                  </Pressable>
                </View>

                {!isAdminView ? (
                  <Text style={styles.helpText}>
                    Vinculos fora da sua gestao ficam como somente visualizacao.
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  restrictedWrap: {
    flex: 1,
    padding: spacing.md,
    justifyContent: "center",
  },
  title: {
    ...typography.sectionTitle,
    color: colors.navy,
    fontSize: 24,
    lineHeight: 29,
  },
  subtitle: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
    fontSize: 13,
    lineHeight: 18,
  },
  list: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.xs,
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  nameWrap: {
    flex: 1,
  },
  name: {
    ...typography.cardTitle,
    color: colors.navy,
    fontSize: 15,
    lineHeight: 20,
  },
  phone: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
  },
  headerBadges: {
    alignItems: "flex-end",
    gap: 4,
  },
  enterpriseList: {
    gap: 6,
  },
  enterpriseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
  },
  enterpriseName: {
    ...typography.body,
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  actionButton: {
    minHeight: 34,
    borderRadius: radius.md,
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonSecondary: {
    backgroundColor: colors.orange,
  },
  actionButtonOutline: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionButtonText: {
    ...typography.caption,
    color: "#FFFFFF",
    fontSize: 11,
    lineHeight: 14,
  },
  actionButtonTextSecondary: {
    color: "#FFFFFF",
  },
  actionButtonTextOutline: {
    color: colors.navy,
  },
  helpText: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
});
