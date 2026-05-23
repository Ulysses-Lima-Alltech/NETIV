import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { EmptyState } from "../../src/components/EmptyState";
import { StatusBadge } from "../../src/components/StatusBadge";
import { ApiRequestError } from "../../src/services/api";
import {
  addEnterpriseToTeamMemberWithApi,
  getEnterpriseOptionsWithApi,
  getTeamWithApi,
  updateTeamMemberWithApi,
  type TeamEnterpriseOption,
} from "../../src/services/team.service";
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

  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [linkMember, setLinkMember] = useState<TeamMember | null>(null);
  const [enterpriseOptions, setEnterpriseOptions] = useState<TeamEnterpriseOption[]>([]);
  const [isLoadingEnterprises, setIsLoadingEnterprises] = useState(false);
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string | null>(null);
  const [isSavingLink, setIsSavingLink] = useState(false);

  useEffect(() => {
    void loadTeam();
  }, [token, role]);

  const availableEnterprisesForMember = useMemo(() => {
    if (!linkMember) return [];
    const linkedIds = new Set(linkMember.enterprises.map((enterprise) => enterprise.enterpriseId));
    return enterpriseOptions.filter((option) => !linkedIds.has(option.id));
  }, [enterpriseOptions, linkMember]);

  async function loadTeam() {
    setIsLoading(true);
    setErrorMessage(null);

    if (!token) {
      setTeam([]);
      setErrorMessage("Sessao sem token. Faca login novamente.");
      setIsLoading(false);
      return;
    }

    try {
      const members = await getTeamWithApi(token);
      setTeam(members);
    } catch (error) {
      setTeam([]);
      if (error instanceof ApiRequestError && error.status === 403) {
        setErrorMessage("Sem permissao para visualizar equipe.");
      } else {
        setErrorMessage("Nao foi possivel carregar a equipe.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  function openEditModal(member: TeamMember) {
    setEditMember(member);
    setEditName(member.name);
    setEditPhone(member.phone ?? "");
    setEditActive(member.active);
  }

  function closeEditModal() {
    if (isSavingEdit) return;
    setEditMember(null);
    setEditName("");
    setEditPhone("");
    setEditActive(true);
  }

  async function handleSaveEdit() {
    if (!token || !editMember) return;
    const nextName = editName.trim();
    if (!nextName) {
      Alert.alert("Nome obrigatorio", "Informe um nome valido para salvar.");
      return;
    }

    setIsSavingEdit(true);
    try {
      const updatedMember = await updateTeamMemberWithApi(editMember.id, token, {
        name: nextName,
        phone: editPhone,
        active: editActive,
      });
      setTeam((items) => items.map((item) => (item.id === updatedMember.id ? updatedMember : item)));
      closeEditModal();
      Alert.alert("Sucesso", "Membro atualizado.");
      await loadTeam();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        Alert.alert("Falha na edicao", error.message || "Nao foi possivel editar o membro.");
      } else {
        Alert.alert("Falha na edicao", "Nao foi possivel editar o membro.");
      }
    } finally {
      setIsSavingEdit(false);
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
      await loadTeam();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        Alert.alert("Falha na edicao", error.message || "Nao foi possivel alterar o status.");
      } else {
        Alert.alert("Falha na edicao", "Nao foi possivel alterar o status.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function openAddEnterpriseModal(member: TeamMember) {
    if (!token) {
      Alert.alert("Sessao invalida", "Faca login novamente para vincular empreendimentos.");
      return;
    }

    setLinkMember(member);
    setSelectedEnterpriseId(null);
    setIsLoadingEnterprises(true);
    try {
      const options = await getEnterpriseOptionsWithApi(token);
      setEnterpriseOptions(options);
    } catch (error) {
      setEnterpriseOptions([]);
      if (error instanceof ApiRequestError) {
        Alert.alert("Falha ao carregar empreendimentos", error.message || "Nao foi possivel carregar a lista.");
      } else {
        Alert.alert("Falha ao carregar empreendimentos", "Nao foi possivel carregar a lista.");
      }
    } finally {
      setIsLoadingEnterprises(false);
    }
  }

  function closeAddEnterpriseModal() {
    if (isSavingLink) return;
    setLinkMember(null);
    setSelectedEnterpriseId(null);
    setEnterpriseOptions([]);
  }

  async function handleConfirmAddEnterprise() {
    if (!token || !linkMember) return;
    if (!selectedEnterpriseId) {
      Alert.alert("Selecao obrigatoria", "Escolha um empreendimento antes de confirmar.");
      return;
    }

    setIsSavingLink(true);
    try {
      await addEnterpriseToTeamMemberWithApi(linkMember.id, selectedEnterpriseId, token);
      closeAddEnterpriseModal();
      Alert.alert("Vinculo adicionado", "Empreendimento vinculado com sucesso.");
      await loadTeam();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        Alert.alert("Falha no vinculo", error.message || "Nao foi possivel vincular empreendimento.");
      } else {
        Alert.alert("Falha no vinculo", "Nao foi possivel vincular empreendimento.");
      }
    } finally {
      setIsSavingLink(false);
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
                      onPress={() => openEditModal(member)}
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
                      onPress={() => openAddEnterpriseModal(member)}
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

      <Modal visible={editMember != null} transparent animationType="fade" onRequestClose={closeEditModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Editar membro</Text>
            <Text style={styles.modalSubtitle}>Atualize nome, telefone e status do membro.</Text>

            <Text style={styles.inputLabel}>Nome</Text>
            <TextInput value={editName} onChangeText={setEditName} style={styles.input} placeholder="Nome completo" />

            <Text style={styles.inputLabel}>Telefone</Text>
            <TextInput
              value={editPhone}
              onChangeText={setEditPhone}
              style={styles.input}
              placeholder="Telefone"
              keyboardType="phone-pad"
            />

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Membro ativo</Text>
              <Switch value={editActive} onValueChange={setEditActive} />
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={closeEditModal}
                disabled={isSavingEdit}
              >
                <Text style={styles.modalButtonCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalButtonConfirm, isSavingEdit && styles.actionButtonDisabled]}
                onPress={handleSaveEdit}
                disabled={isSavingEdit}
              >
                {isSavingEdit ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalButtonConfirmText}>Salvar</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={linkMember != null} transparent animationType="fade" onRequestClose={closeAddEnterpriseModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Adicionar empreendimento</Text>
            <Text style={styles.modalSubtitle}>Escolha explicitamente o empreendimento para vincular.</Text>

            {isLoadingEnterprises ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="small" color={colors.orange} />
                <Text style={styles.loadingText}>Carregando empreendimentos</Text>
              </View>
            ) : availableEnterprisesForMember.length === 0 ? (
              <EmptyState
                icon="office-building-outline"
                title="Nenhum empreendimento disponivel"
                description="Todos os empreendimentos disponiveis ja estao vinculados a este membro."
              />
            ) : (
              <ScrollView style={styles.enterpriseOptionsList}>
                {availableEnterprisesForMember.map((option) => {
                  const selected = selectedEnterpriseId === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      style={[styles.enterpriseOptionRow, selected ? styles.enterpriseOptionRowSelected : null]}
                      onPress={() => setSelectedEnterpriseId(option.id)}
                    >
                      <View style={styles.enterpriseOptionTextWrap}>
                        <Text style={styles.enterpriseOptionTitle}>{option.name}</Text>
                        <Text style={styles.enterpriseOptionMeta}>
                          {option.active ? "Ativo" : "Inativo"}
                        </Text>
                      </View>
                      <StatusBadge label={selected ? "Selecionado" : "Selecionar"} tone={selected ? "info" : "neutral"} />
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={closeAddEnterpriseModal}
                disabled={isSavingLink}
              >
                <Text style={styles.modalButtonCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalButtonConfirm, isSavingLink && styles.actionButtonDisabled]}
                onPress={handleConfirmAddEnterprise}
                disabled={isSavingLink || !selectedEnterpriseId}
              >
                {isSavingLink ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalButtonConfirmText}>Confirmar</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    padding: spacing.md,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadows.card,
    maxHeight: "85%",
  },
  modalTitle: {
    ...typography.cardTitle,
    color: colors.navy,
    fontSize: 17,
    lineHeight: 22,
  },
  modalSubtitle: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 3,
    marginBottom: spacing.sm,
    fontSize: 11,
    lineHeight: 15,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.navy,
    marginTop: spacing.xs,
    marginBottom: 4,
    fontWeight: "700",
  },
  input: {
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FBFDFF",
    paddingHorizontal: spacing.sm,
    color: colors.text,
  },
  switchRow: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switchLabel: {
    ...typography.body,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  modalActions: {
    marginTop: spacing.md,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.xs,
  },
  modalButton: {
    minHeight: 36,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  modalButtonCancel: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  modalButtonConfirm: {
    backgroundColor: colors.navy,
  },
  modalButtonCancelText: {
    ...typography.caption,
    color: colors.navy,
    fontWeight: "700",
  },
  modalButtonConfirmText: {
    ...typography.caption,
    color: "#FFFFFF",
    fontWeight: "700",
  },
  modalLoading: {
    paddingVertical: spacing.sm,
    alignItems: "center",
    gap: spacing.xs,
  },
  enterpriseOptionsList: {
    maxHeight: 280,
  },
  enterpriseOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: 6,
  },
  enterpriseOptionRowSelected: {
    borderColor: colors.navy,
    backgroundColor: colors.blueSoft,
  },
  enterpriseOptionTextWrap: {
    flex: 1,
  },
  enterpriseOptionTitle: {
    ...typography.body,
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  enterpriseOptionMeta: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 2,
    fontSize: 10,
  },
});
