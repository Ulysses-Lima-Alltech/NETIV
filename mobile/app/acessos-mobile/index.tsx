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
  createMobileAccessForTeamMemberWithApi,
  getTeamWithApi,
  type CreateTeamAccessPayload,
} from "../../src/services/team.service";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";
import { TeamMember } from "../../src/types/team.types";

export default function MobileAccessesScreen() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const role = user?.role ?? "CORRETOR";

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [accessMember, setAccessMember] = useState<TeamMember | null>(null);
  const [accessUsername, setAccessUsername] = useState("");
  const [accessPassword, setAccessPassword] = useState("");
  const [accessRole, setAccessRole] = useState<"CORRETOR" | "GESTOR">("CORRETOR");
  const [accessActive, setAccessActive] = useState(true);
  const [isCreatingAccess, setIsCreatingAccess] = useState(false);

  const [manageMember, setManageMember] = useState<TeamMember | null>(null);

  useEffect(() => {
    void loadMembers();
  }, [token, role]);

  const orderedMembers = useMemo(() => {
    return [...members].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [members]);

  async function loadMembers() {
    setIsLoading(true);
    setErrorMessage(null);

    if (!token) {
      setMembers([]);
      setErrorMessage("Sessao sem token. Faca login novamente.");
      setIsLoading(false);
      return;
    }

    try {
      const response = await getTeamWithApi(token);
      setMembers(response);
    } catch (error) {
      setMembers([]);
      if (error instanceof ApiRequestError && error.status === 403) {
        setErrorMessage("Sem permissao para visualizar acessos mobile.");
      } else {
        setErrorMessage("Nao foi possivel carregar acessos mobile.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshMembers() {
    if (!token) return;
    setIsRefreshing(true);
    try {
      const response = await getTeamWithApi(token);
      setMembers(response);
    } finally {
      setIsRefreshing(false);
    }
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

  async function handleCreateAccessExplicit() {
    if (!token || !accessMember) return;
    const username = accessUsername.trim().toLowerCase();
    const temporaryPassword = accessPassword.trim();

    if (!username) {
      Alert.alert("Login obrigatorio", "Informe o usuario/login.");
      return;
    }

    if (!temporaryPassword) {
      Alert.alert("Senha obrigatoria", "Informe a senha temporaria.");
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
      await refreshMembers();
      Alert.alert(
        "Acesso criado",
        `Login ${result.user.username} criado para ${result.user.name}. Compartilhe a senha temporaria com seguranca.`
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

  function openManageAccessModal(member: TeamMember) {
    setManageMember(member);
  }

  function closeManageAccessModal() {
    setManageMember(null);
  }

  if (role !== "ADM") {
    return (
      <AppShell>
        <View style={styles.restrictedWrap}>
          <EmptyState
            icon="shield-crown-outline"
            title="Acesso restrito"
            description="Apenas administradores podem criar e gerenciar acessos mobile."
          />
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Acessos mobile</Text>
        <Text style={styles.subtitle}>
          Crie e gerencie os logins usados somente no aplicativo mobile.
        </Text>
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

        <View style={styles.list}>
          {isLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={colors.orange} />
              <Text style={styles.loadingText}>Carregando acessos</Text>
            </View>
          ) : orderedMembers.length === 0 ? (
            <EmptyState
              icon="account-group-outline"
              title="Nenhum membro encontrado"
              description="Quando houver membros no seu escopo, eles aparecerao aqui."
            />
          ) : (
            orderedMembers.map((member) => {
              const canCreate = member.mobileAccess == null && member.id.startsWith("corretor:");
              const hasAccess = member.mobileAccess != null;
              const access = member.mobileAccess;

              return (
                <View key={member.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.nameWrap}>
                      <Text style={styles.name}>{member.name}</Text>
                      <Text style={styles.phone}>{member.phone ?? "-"}</Text>
                    </View>
                    <View style={styles.headerBadges}>
                      <StatusBadge label={member.role} tone={member.role === "GESTOR" ? "warning" : member.role === "ADM" ? "inverse" : "info"} />
                      {hasAccess && access ? (
                        access.active ? (
                          <StatusBadge label="Com acesso" tone="success" />
                        ) : (
                          <StatusBadge label="Inativo" tone="warning" />
                        )
                      ) : (
                        <StatusBadge label="Sem acesso" tone="neutral" />
                      )}
                    </View>
                  </View>

                  {hasAccess && access ? (
                    <Text style={styles.accessInfo}>
                      Username: {access.username}
                    </Text>
                  ) : null}

                  <View style={styles.actionsRow}>
                    {canCreate ? (
                      <Pressable style={styles.actionButton} onPress={() => openCreateAccessModal(member)}>
                        <Text style={styles.actionButtonText}>Criar acesso</Text>
                      </Pressable>
                    ) : null}

                    {hasAccess ? (
                      <Pressable
                        style={[styles.actionButton, styles.actionButtonSecondary]}
                        onPress={() => openManageAccessModal(member)}
                      >
                        <Text style={styles.actionButtonText}>Gerenciar acesso</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>
        {isRefreshing ? <Text style={styles.refreshText}>Atualizando...</Text> : null}
      </ScrollView>

      <Modal visible={accessMember != null} transparent animationType="fade" onRequestClose={() => closeCreateAccessModal()}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Criar acesso mobile</Text>
            <Text style={styles.modalSubtitle}>
              Crie login para {accessMember?.name ?? "o membro selecionado"}.
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

            <Text style={styles.inputLabel}>Papel</Text>
            <View style={styles.roleSelectorRow}>
              <Pressable
                style={[styles.roleOption, accessRole === "CORRETOR" ? styles.roleOptionActive : styles.roleOptionInactive]}
                onPress={() => setAccessRole("CORRETOR")}
                disabled={isCreatingAccess}
              >
                <Text style={[styles.roleOptionText, accessRole === "CORRETOR" ? styles.roleOptionTextActive : styles.roleOptionTextInactive]}>
                  CORRETOR
                </Text>
              </Pressable>
              <Pressable
                style={[styles.roleOption, accessRole === "GESTOR" ? styles.roleOptionActive : styles.roleOptionInactive]}
                onPress={() => setAccessRole("GESTOR")}
                disabled={isCreatingAccess}
              >
                <Text style={[styles.roleOptionText, accessRole === "GESTOR" ? styles.roleOptionTextActive : styles.roleOptionTextInactive]}>
                  GESTOR
                </Text>
              </Pressable>
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Acesso ativo</Text>
              <Switch value={accessActive} onValueChange={setAccessActive} disabled={isCreatingAccess} />
            </View>

            <View style={styles.modalActions}>
              <Pressable style={[styles.modalButton, styles.modalButtonCancel]} onPress={() => closeCreateAccessModal()} disabled={isCreatingAccess}>
                <Text style={styles.modalButtonCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalButtonConfirm, isCreatingAccess && styles.actionButtonDisabled]}
                onPress={handleCreateAccessExplicit}
                disabled={isCreatingAccess}
              >
                {isCreatingAccess ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.modalButtonConfirmText}>Criar acesso</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={manageMember != null} transparent animationType="fade" onRequestClose={closeManageAccessModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Gerenciar acesso</Text>
            <Text style={styles.modalSubtitle}>
              Acesso de {manageMember?.name ?? "membro selecionado"}.
            </Text>
            <View style={styles.manageInfoBox}>
              <Text style={styles.manageInfoLine}>
                Username: {manageMember?.mobileAccess?.username ?? "-"}
              </Text>
              <Text style={styles.manageInfoLine}>
                Papel: {manageMember?.mobileAccess?.role ?? "-"}
              </Text>
              <Text style={styles.manageInfoLine}>
                Status: {manageMember?.mobileAccess?.active ? "Ativo" : "Inativo"}
              </Text>
            </View>
            <Text style={styles.manageHint}>
              Ativar/Inativar e redefinir senha temporaria dependem de endpoint dedicado de gestao de acesso.
            </Text>
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalButton, styles.modalButtonCancel]} onPress={closeManageAccessModal}>
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
  accessInfo: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 10,
    lineHeight: 14,
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
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
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    ...typography.caption,
    color: "#FFFFFF",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
  },
  refreshText: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.sm,
    textAlign: "center",
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
  manageInfoBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundAlt,
    padding: spacing.sm,
    gap: 4,
  },
  manageInfoLine: {
    ...typography.caption,
    color: colors.text,
  },
  manageHint: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.sm,
    fontSize: 11,
    lineHeight: 15,
  },
});
