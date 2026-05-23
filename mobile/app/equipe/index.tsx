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
  createMobileAccessForTeamMemberWithApi,
  getEnterpriseOptionsWithApi,
  getTeamWithApi,
  removeEnterpriseFromTeamMemberWithApi,
  updateTeamMemberWithApi,
  type CreateTeamAccessPayload,
  type TeamEnterpriseOption,
} from "../../src/services/team.service";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";
import { TeamEnterprise, TeamMember } from "../../src/types/team.types";

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

  const [manageMember, setManageMember] = useState<TeamMember | null>(null);
  const [enterpriseOptions, setEnterpriseOptions] = useState<TeamEnterpriseOption[]>([]);
  const [isLoadingEnterprises, setIsLoadingEnterprises] = useState(false);
  const [actionInProgressKey, setActionInProgressKey] = useState<string | null>(null);

  const [accessMember, setAccessMember] = useState<TeamMember | null>(null);
  const [accessUsername, setAccessUsername] = useState("");
  const [accessPassword, setAccessPassword] = useState("");
  const [accessRole, setAccessRole] = useState<"CORRETOR" | "GESTOR">("CORRETOR");
  const [accessActive, setAccessActive] = useState(true);
  const [isCreatingAccess, setIsCreatingAccess] = useState(false);

  useEffect(() => {
    void loadTeam();
  }, [token, role]);

  const linkedEnterprises = useMemo(() => {
    return manageMember?.enterprises ?? [];
  }, [manageMember]);

  const availableEnterprises = useMemo(() => {
    if (!manageMember) return [];
    const linkedIds = new Set(manageMember.enterprises.map((enterprise) => enterprise.enterpriseId));
    return enterpriseOptions.filter((option) => !linkedIds.has(option.id));
  }, [enterpriseOptions, manageMember]);

  function canRemoveLinkedEnterprise(enterprise: TeamEnterprise): boolean {
    if (role === "ADM") return true;
    return enterprise.manageable === true;
  }

  function openCreateAccessModal(member: TeamMember) {
    const suggestedUsername = member.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 30);

    setAccessMember(member);
    setAccessUsername(suggestedUsername || "");
    setAccessPassword("");
    setAccessRole("CORRETOR");
    setAccessActive(true);
  }

  function closeCreateAccessModal(force = false) {
    if (isCreatingAccess && !force) return;
    setAccessMember(null);
    setAccessUsername("");
    setAccessPassword("");
    setAccessRole("CORRETOR");
    setAccessActive(true);
  }

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

  async function refreshTeamAndManagedMember(memberId?: string) {
    if (!token) return;
    const members = await getTeamWithApi(token);
    setTeam(members);

    if (!memberId) return;
    const updated = members.find((member) => member.id === memberId) ?? null;
    setManageMember(updated);
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

  async function handleCreateMobileAccess() {
    if (!token || !accessMember) return;
    const username = accessUsername.trim().toLowerCase();
    const temporaryPassword = accessPassword.trim();

    if (!username) {
      Alert.alert("Login obrigatorio", "Informe o usuario/login para criar o acesso.");
      return;
    }

    if (!temporaryPassword) {
      Alert.alert("Senha obrigatoria", "Informe a senha temporaria para criar o acesso.");
      return;
    }

    const payload: CreateTeamAccessPayload = {
      username,
      temporaryPassword,
      role: accessRole,
      active: accessActive,
    };

    setIsCreatingAccess(true);
    try {
      const result = await createMobileAccessForTeamMemberWithApi(accessMember.id, token, payload);
      closeCreateAccessModal(true);
      await loadTeam();
      Alert.alert(
        "Acesso criado",
        `Acesso mobile criado para ${result.user.name} (${result.user.username}). Compartilhe a senha temporaria com seguranca.`
      );
    } catch (error) {
      if (error instanceof ApiRequestError) {
        Alert.alert("Falha ao criar acesso", error.message || "Nao foi possivel criar o acesso mobile.");
      } else {
        Alert.alert("Falha ao criar acesso", "Nao foi possivel criar o acesso mobile.");
      }
    } finally {
      setIsCreatingAccess(false);
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

  async function openManageEnterprisesModal(member: TeamMember) {
    if (!token) {
      Alert.alert("Sessao invalida", "Faca login novamente para gerenciar empreendimentos.");
      return;
    }

    setManageMember(member);
    setActionInProgressKey(null);
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

  function closeManageEnterprisesModal() {
    if (actionInProgressKey != null) return;
    setManageMember(null);
    setEnterpriseOptions([]);
    setIsLoadingEnterprises(false);
    setActionInProgressKey(null);
  }

  async function handleAddEnterpriseExplicit(enterpriseId: string) {
    if (!token || !manageMember) return;
    const actionKey = `add:${enterpriseId}`;
    setActionInProgressKey(actionKey);
    try {
      await addEnterpriseToTeamMemberWithApi(manageMember.id, enterpriseId, token);
      await refreshTeamAndManagedMember(manageMember.id);
      Alert.alert("Vinculo adicionado", "Empreendimento vinculado com sucesso.");
    } catch (error) {
      if (error instanceof ApiRequestError) {
        Alert.alert("Falha no vinculo", error.message || "Nao foi possivel vincular empreendimento.");
      } else {
        Alert.alert("Falha no vinculo", "Nao foi possivel vincular empreendimento.");
      }
    } finally {
      setActionInProgressKey(null);
    }
  }

  async function handleRemoveEnterpriseExplicit(enterpriseId: string) {
    if (!token || !manageMember) return;
    const enterprise = manageMember.enterprises.find((item) => item.enterpriseId === enterpriseId);
    if (!enterprise) return;

    if (!canRemoveLinkedEnterprise(enterprise)) {
      Alert.alert(
        "Sem permissao para remover",
        "Este vinculo esta fora da sua area gerenciavel e nao pode ser removido por este perfil."
      );
      return;
    }

    const actionKey = `remove:${enterpriseId}`;
    setActionInProgressKey(actionKey);
    try {
      await removeEnterpriseFromTeamMemberWithApi(manageMember.id, enterpriseId, token);
      await refreshTeamAndManagedMember(manageMember.id);
      Alert.alert("Vinculo removido", "Empreendimento removido com sucesso.");
    } catch (error) {
      if (error instanceof ApiRequestError) {
        Alert.alert("Falha ao remover", error.message || "Nao foi possivel remover o vinculo.");
      } else {
        Alert.alert("Falha ao remover", "Nao foi possivel remover o vinculo.");
      }
    } finally {
      setActionInProgressKey(null);
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
                      {member.mobileAccess ? (
                        <StatusBadge
                          label={member.mobileAccess.active ? "Acesso ativo" : "Acesso inativo"}
                          tone={member.mobileAccess.active ? "success" : "warning"}
                        />
                      ) : (
                        <StatusBadge label="Sem acesso mobile" tone="neutral" />
                      )}
                    </View>
                  </View>

                  {member.mobileAccess ? (
                    <Text style={styles.accessInfoText}>Login mobile: {member.mobileAccess.username}</Text>
                  ) : null}

                  <View style={styles.enterpriseList}>
                    {member.enterprises.map((enterprise) => (
                      <View key={`${member.id}-${enterprise.enterpriseId}`} style={styles.enterpriseRow}>
                        <Text style={styles.enterpriseName}>{enterprise.enterpriseName}</Text>
                        <StatusBadge
                          label={enterprise.manageable ? "Gerenciavel" : "Somente visualizacao"}
                          tone={enterprise.manageable ? "success" : "neutral"}
                        />
                      </View>
                    ))}
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
                      onPress={() => openManageEnterprisesModal(member)}
                      disabled={isSubmitting}
                    >
                      <Text style={[styles.actionButtonText, styles.actionButtonTextOutline]}>
                        Gerenciar empreendimentos
                      </Text>
                    </Pressable>

                    {role === "ADM" && !member.mobileAccess && member.id.startsWith("corretor:") ? (
                      <Pressable
                        style={[
                          styles.actionButton,
                          styles.actionButtonSuccess,
                          isSubmitting && styles.actionButtonDisabled,
                        ]}
                        onPress={() => openCreateAccessModal(member)}
                        disabled={isSubmitting}
                      >
                        <Text style={styles.actionButtonText}>Criar acesso</Text>
                      </Pressable>
                    ) : null}
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

      <Modal visible={accessMember != null} transparent animationType="fade" onRequestClose={() => closeCreateAccessModal()}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Criar acesso mobile</Text>
            <Text style={styles.modalSubtitle}>
              Crie login para {accessMember?.name ?? "o membro selecionado"}. A senha informada sera temporaria.
            </Text>

            <Text style={styles.inputLabel}>Usuario/login</Text>
            <TextInput
              value={accessUsername}
              onChangeText={setAccessUsername}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="ex.: marcelo"
            />

            <Text style={styles.inputLabel}>Senha temporaria</Text>
            <TextInput
              value={accessPassword}
              onChangeText={setAccessPassword}
              style={styles.input}
              placeholder="Senha temporaria"
              secureTextEntry
            />

            <Text style={styles.inputLabel}>Papel de acesso</Text>
            <View style={styles.roleSelectorRow}>
              <Pressable
                style={[
                  styles.roleOption,
                  accessRole === "CORRETOR" ? styles.roleOptionActive : styles.roleOptionInactive,
                ]}
                onPress={() => setAccessRole("CORRETOR")}
                disabled={isCreatingAccess}
              >
                <Text
                  style={[
                    styles.roleOptionText,
                    accessRole === "CORRETOR" ? styles.roleOptionTextActive : styles.roleOptionTextInactive,
                  ]}
                >
                  CORRETOR
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.roleOption,
                  accessRole === "GESTOR" ? styles.roleOptionActive : styles.roleOptionInactive,
                ]}
                onPress={() => setAccessRole("GESTOR")}
                disabled={isCreatingAccess}
              >
                <Text
                  style={[
                    styles.roleOptionText,
                    accessRole === "GESTOR" ? styles.roleOptionTextActive : styles.roleOptionTextInactive,
                  ]}
                >
                  GESTOR
                </Text>
              </Pressable>
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Acesso ativo</Text>
              <Switch value={accessActive} onValueChange={setAccessActive} disabled={isCreatingAccess} />
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => closeCreateAccessModal()}
                disabled={isCreatingAccess}
              >
                <Text style={styles.modalButtonCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalButtonConfirm, isCreatingAccess && styles.actionButtonDisabled]}
                onPress={handleCreateMobileAccess}
                disabled={isCreatingAccess}
              >
                {isCreatingAccess ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalButtonConfirmText}>Criar acesso</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={manageMember != null}
        transparent
        animationType="fade"
        onRequestClose={closeManageEnterprisesModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCardLarge}>
            <Text style={styles.modalTitle}>Gerenciar empreendimentos</Text>
            <Text style={styles.modalSubtitle}>
              Adicione e remova vinculos explicitamente para {manageMember?.name ?? "o membro selecionado"}.
            </Text>

            {isLoadingEnterprises ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="small" color={colors.orange} />
                <Text style={styles.loadingText}>Carregando empreendimentos</Text>
              </View>
            ) : (
              <ScrollView style={styles.managementScroll}>
                <Text style={styles.sectionTitle}>Vinculados</Text>
                {linkedEnterprises.length === 0 ? (
                  <Text style={styles.emptyInlineText}>Este membro ainda nao possui empreendimentos vinculados.</Text>
                ) : (
                  linkedEnterprises.map((enterprise) => {
                    const canRemove = canRemoveLinkedEnterprise(enterprise);
                    const removeKey = `remove:${enterprise.enterpriseId}`;
                    const removing = actionInProgressKey === removeKey;
                    return (
                      <View key={`linked-${enterprise.enterpriseId}`} style={styles.managementRow}>
                        <View style={styles.managementTextWrap}>
                          <Text style={styles.managementTitle}>{enterprise.enterpriseName}</Text>
                          <Text style={styles.managementMeta}>
                            {enterprise.manageable ? "Gerenciavel" : "Somente visualizacao"}
                          </Text>
                        </View>
                        <View style={styles.managementActions}>
                          <StatusBadge
                            label={enterprise.manageable ? "Gerenciavel" : "Somente visualizacao"}
                            tone={enterprise.manageable ? "success" : "neutral"}
                          />
                          {canRemove ? (
                            <Pressable
                              style={[styles.smallActionButton, styles.smallActionRemove, removing && styles.actionButtonDisabled]}
                              onPress={() => handleRemoveEnterpriseExplicit(enterprise.enterpriseId)}
                              disabled={actionInProgressKey != null}
                            >
                              {removing ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                              ) : (
                                <Text style={styles.smallActionText}>Remover</Text>
                              )}
                            </Pressable>
                          ) : (
                            <Text style={styles.lockedText}>Nao gerenciavel</Text>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}

                <Text style={[styles.sectionTitle, styles.sectionTitleSpacing]}>Disponiveis para adicionar</Text>
                {availableEnterprises.length === 0 ? (
                  <Text style={styles.emptyInlineText}>Nao ha empreendimentos disponiveis para adicionar.</Text>
                ) : (
                  availableEnterprises.map((option) => {
                    const addKey = `add:${option.id}`;
                    const adding = actionInProgressKey === addKey;
                    return (
                      <View key={`available-${option.id}`} style={styles.managementRow}>
                        <View style={styles.managementTextWrap}>
                          <Text style={styles.managementTitle}>{option.name}</Text>
                          <Text style={styles.managementMeta}>{option.active ? "Ativo" : "Inativo"}</Text>
                        </View>
                        <View style={styles.managementActions}>
                          <StatusBadge label={option.active ? "Ativo" : "Inativo"} tone={option.active ? "success" : "warning"} />
                          <Pressable
                            style={[styles.smallActionButton, styles.smallActionAdd, adding && styles.actionButtonDisabled]}
                            onPress={() => handleAddEnterpriseExplicit(option.id)}
                            disabled={actionInProgressKey != null}
                          >
                            {adding ? (
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                              <Text style={styles.smallActionText}>Adicionar</Text>
                            )}
                          </Pressable>
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            )}

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={closeManageEnterprisesModal}
                disabled={actionInProgressKey != null}
              >
                <Text style={styles.modalButtonCancelText}>Fechar</Text>
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
  actionButtonSuccess: {
    backgroundColor: colors.green,
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
  accessInfoText: {
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
  modalCardLarge: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadows.card,
    maxHeight: "88%",
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
  roleSelectorRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: 2,
  },
  roleOption: {
    flex: 1,
    minHeight: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  roleOptionActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  roleOptionInactive: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  roleOptionText: {
    ...typography.caption,
    fontWeight: "700",
  },
  roleOptionTextActive: {
    color: "#FFFFFF",
  },
  roleOptionTextInactive: {
    color: colors.navy,
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
  managementScroll: {
    maxHeight: 430,
  },
  sectionTitle: {
    ...typography.cardTitle,
    color: colors.navy,
    fontSize: 14,
    lineHeight: 19,
    marginBottom: spacing.xs,
  },
  sectionTitleSpacing: {
    marginTop: spacing.sm,
  },
  emptyInlineText: {
    ...typography.caption,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  managementRow: {
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
  managementTextWrap: {
    flex: 1,
  },
  managementTitle: {
    ...typography.body,
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  managementMeta: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 2,
    fontSize: 10,
  },
  managementActions: {
    alignItems: "flex-end",
    gap: 5,
  },
  smallActionButton: {
    minHeight: 30,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  smallActionAdd: {
    backgroundColor: colors.navy,
  },
  smallActionRemove: {
    backgroundColor: colors.red,
  },
  smallActionText: {
    ...typography.caption,
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 10,
    lineHeight: 13,
  },
  lockedText: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "700",
  },
});
