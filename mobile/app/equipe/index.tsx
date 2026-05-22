import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { EmptyState } from "../../src/components/EmptyState";
import { StatusBadge } from "../../src/components/StatusBadge";
import {
  addEnterpriseToTeamMemberWithApi,
  getTeamByRoleFallback,
  getTeamWithApi,
  isTeamApiFallbackAllowed,
  updateTeamMemberWithApi,
} from "../../src/services/team.service";
import { ApiRequestError } from "../../src/services/api";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";
import { TeamMember } from "../../src/types/team.types";

export default function TeamScreen() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const role = user?.role ?? "CORRETOR";
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadTeam() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        if (token) {
          const members = await getTeamWithApi(token);
          if (active) {
            setTeam(members);
          }
          return;
        }
      } catch (error) {
        if (!isTeamApiFallbackAllowed(error)) {
          if (active) {
            setTeam([]);
            if (error instanceof ApiRequestError && error.status === 403) {
              setErrorMessage("Sem permissao para visualizar equipe.");
            } else {
              setErrorMessage("Nao foi possivel carregar a equipe.");
            }
          }
          return;
        }

        const fallbackItems = await getTeamByRoleFallback(role);
        if (active) {
          setTeam(fallbackItems);
          setErrorMessage("Conexao indisponivel. Exibindo dados locais temporarios.");
        }
        return;
      }

      const fallbackItems = await getTeamByRoleFallback(role);
      if (active) {
        setTeam(fallbackItems);
        setErrorMessage("Sessao sem token. Exibindo dados locais temporarios.");
      }
    }

    loadTeam().finally(() => {
      if (active) {
        setIsLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [role, token]);

  async function reloadTeam() {
    if (!token) return;
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const members = await getTeamWithApi(token);
      setTeam(members);
    } catch (error) {
      if (isTeamApiFallbackAllowed(error)) {
        const fallbackItems = await getTeamByRoleFallback(role);
        setTeam(fallbackItems);
        setErrorMessage("Conexao indisponivel. Exibindo dados locais temporarios.");
      } else {
        setErrorMessage("Nao foi possivel atualizar a equipe.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleEdit(memberId: string) {
    if (!token) {
      Alert.alert("Sessao invalida", "Faca login novamente para editar membros.");
      return;
    }
    const current = team.find((member) => member.id === memberId);
    if (!current) return;

    setIsSubmitting(true);
    try {
      const updatedMember = await updateTeamMemberWithApi(memberId, token, {
        name: `${current.name} (editado)`,
        phone: current.phone ?? "",
      });
      setTeam((items) => items.map((item) => (item.id === updatedMember.id ? updatedMember : item)));
      await reloadTeam();
      Alert.alert("Sucesso", "Membro atualizado.");
    } catch (error) {
      if (error instanceof ApiRequestError) {
        Alert.alert("Falha na edicao", error.message || "Nao foi possivel editar o membro.");
        return;
      }
      Alert.alert("Falha na edicao", "Nao foi possivel editar o membro.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleActive(memberId: string) {
    if (!token) {
      Alert.alert("Sessao invalida", "Faca login novamente para editar membros.");
      return;
    }
    const current = team.find((member) => member.id === memberId);
    if (!current) return;

    setIsSubmitting(true);
    try {
      const updatedMember = await updateTeamMemberWithApi(memberId, token, {
        active: !current.active,
      });
      setTeam((items) => items.map((item) => (item.id === updatedMember.id ? updatedMember : item)));
      await reloadTeam();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        Alert.alert("Falha na edicao", error.message || "Nao foi possivel alterar o status.");
        return;
      }
      Alert.alert("Falha na edicao", "Nao foi possivel alterar o status.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAddEnterprise(memberId: string) {
    if (!token) {
      Alert.alert("Sessao invalida", "Faca login novamente para vincular empreendimentos.");
      return;
    }

    const enterpriseOptions = Array.from(
      new Map(
        team
          .flatMap((member) => member.enterprises)
          .map((enterprise) => [enterprise.enterpriseId, enterprise])
      ).values()
    ).sort((a, b) => a.enterpriseName.localeCompare(b.enterpriseName, "pt-BR"));

    if (enterpriseOptions.length === 0) {
      Alert.alert("Sem empreendimentos", "Nao ha empreendimentos disponiveis para vincular.");
      return;
    }

    const member = team.find((item) => item.id === memberId);
    if (!member) return;
    const available = enterpriseOptions.filter(
      (enterprise) => !member.enterprises.some((current) => current.enterpriseId === enterprise.enterpriseId)
    );
    const selected = available[0] ?? enterpriseOptions[0];

    setIsSubmitting(true);
    try {
      await addEnterpriseToTeamMemberWithApi(memberId, selected.enterpriseId, token);
      await reloadTeam();
      Alert.alert("Vinculo adicionado", `Empreendimento ${selected.enterpriseName} vinculado com sucesso.`);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        Alert.alert("Falha no vinculo", error.message || "Nao foi possivel vincular empreendimento.");
        return;
      }
      Alert.alert("Falha no vinculo", "Nao foi possivel vincular empreendimento.");
    } finally {
      setIsSubmitting(false);
    }
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
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

        <View style={styles.list}>
          {isLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={colors.orange} />
              <Text style={styles.loadingText}>Carregando equipe</Text>
            </View>
          ) : team.length === 0 ? (
            <EmptyState
              icon="account-group-outline"
              title="Nenhum membro encontrado"
              description="Quando houver membros no seu escopo de acesso, eles aparecerao aqui."
            />
          ) : (
            team.map((member) => {
            const isAdminView = role === "ADM";

            return (
              <View key={member.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.nameWrap}>
                    <Text style={styles.name}>{member.name}</Text>
                    <Text style={styles.phone}>{member.phone ?? "-"}</Text>
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
                    const tone = enterprise.manageable ? "success" : "neutral";

                    return (
                      <View key={`${member.id}-${enterprise.enterpriseId}`} style={styles.enterpriseRow}>
                        <Text style={styles.enterpriseName}>{enterprise.enterpriseName}</Text>
                        <StatusBadge label={enterprise.label ?? "Sem status"} tone={tone} />
                      </View>
                    );
                  })}
                </View>

                <View style={styles.actionsRow}>
                  <Pressable
                    style={[styles.actionButton, isSubmitting && styles.actionButtonDisabled]}
                    onPress={() => handleEdit(member.id)}
                    disabled={isSubmitting}
                  >
                    <Text style={styles.actionButtonText}>Editar</Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.actionButton,
                      styles.actionButtonSecondary,
                      isSubmitting && styles.actionButtonDisabled,
                    ]}
                    onPress={() => handleToggleActive(member.id)}
                    disabled={isSubmitting}
                  >
                    <Text style={[styles.actionButtonText, styles.actionButtonTextSecondary]}>
                      {member.active ? "Inativar" : "Ativar"}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.actionButton,
                      styles.actionButtonOutline,
                      isSubmitting && styles.actionButtonDisabled,
                    ]}
                    onPress={() => handleAddEnterprise(member.id)}
                    disabled={isSubmitting}
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
          })
          )}
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
  loadingCard: {
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
  actionButtonDisabled: {
    opacity: 0.6,
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
  errorText: {
    ...typography.caption,
    color: colors.red,
    marginTop: spacing.xs,
    fontSize: 11,
    lineHeight: 15,
  },
});
