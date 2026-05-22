import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../../src/components/AppShell";
import { EmptyState } from "../../src/components/EmptyState";
import { StatusBadge } from "../../src/components/StatusBadge";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, radius, shadows, spacing, typography } from "../../src/theme";

type TeamRole = "CORRETOR" | "GESTOR" | "ADM";

type TeamMember = {
  id: string;
  name: string;
  phone: string;
  role: TeamRole;
  active: boolean;
  enterprises: string[];
};

const ALL_ENTERPRISES = ["Evora", "Montaresa", "Altis", "Reserva Azul"];
const MANAGED_BY_GESTOR = ["Evora", "Montaresa"];

const INITIAL_TEAM: TeamMember[] = [
  {
    id: "c-1",
    name: "Joao Corretor",
    phone: "(11) 98888-1001",
    role: "CORRETOR",
    active: true,
    enterprises: ["Evora", "Montaresa"],
  },
  {
    id: "c-2",
    name: "Mariana Corretora",
    phone: "(11) 98888-1002",
    role: "CORRETOR",
    active: true,
    enterprises: ["Montaresa"],
  },
  {
    id: "c-3",
    name: "Lucas Corretor",
    phone: "(11) 98888-1003",
    role: "CORRETOR",
    active: false,
    enterprises: ["Altis"],
  },
  {
    id: "g-1",
    name: "Gestor Evora",
    phone: "(11) 97777-2001",
    role: "GESTOR",
    active: true,
    enterprises: ["Evora", "Montaresa"],
  },
  {
    id: "a-1",
    name: "Administrador NETIV",
    phone: "(11) 96666-3001",
    role: "ADM",
    active: true,
    enterprises: ["Evora", "Montaresa", "Altis", "Reserva Azul"],
  },
];

function canManageEnterprise(userRole: TeamRole, enterprise: string) {
  if (userRole === "ADM") return true;
  if (userRole === "GESTOR") return MANAGED_BY_GESTOR.includes(enterprise);
  return false;
}

function nextEnterprise(current: string[]) {
  const missing = ALL_ENTERPRISES.find((enterprise) => !current.includes(enterprise));
  return missing ?? ALL_ENTERPRISES[0];
}

export default function TeamScreen() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role ?? "CORRETOR";
  const [team, setTeam] = useState(INITIAL_TEAM);

  const visibleTeam = useMemo(() => {
    if (role === "ADM") {
      return team;
    }

    if (role === "GESTOR") {
      return team.filter(
        (member) =>
          member.role === "CORRETOR" &&
          member.enterprises.some((enterprise) => MANAGED_BY_GESTOR.includes(enterprise))
      );
    }

    return [];
  }, [role, team]);

  function handleEdit(memberId: string) {
    setTeam((current) =>
      current.map((member) => {
        if (member.id !== memberId) return member;

        const alreadyEdited = member.name.includes(" (editado)");
        return {
          ...member,
          name: alreadyEdited ? member.name.replace(" (editado)", "") : `${member.name} (editado)`,
          phone: member.phone === "(11) 90000-0000" ? "(11) 98888-1000" : "(11) 90000-0000",
        };
      })
    );

    Alert.alert("Edicao mockada", "Nome e telefone atualizados localmente.");
  }

  function handleToggleActive(memberId: string) {
    setTeam((current) =>
      current.map((member) =>
        member.id === memberId ? { ...member, active: !member.active } : member
      )
    );
  }

  function handleAddEnterprise(memberId: string) {
    setTeam((current) =>
      current.map((member) => {
        if (member.id !== memberId) return member;

        const enterprise = nextEnterprise(member.enterprises);
        if (member.enterprises.includes(enterprise)) return member;

        return {
          ...member,
          enterprises: [...member.enterprises, enterprise],
        };
      })
    );

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
          {visibleTeam.map((member) => {
            const isAdminView = role === "ADM";

            return (
              <View key={member.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.nameWrap}>
                    <Text style={styles.name}>{member.name}</Text>
                    <Text style={styles.phone}>{member.phone}</Text>
                  </View>
                  <View style={styles.headerBadges}>
                    <StatusBadge label={member.role} tone={member.role === "ADM" ? "inverse" : member.role === "GESTOR" ? "warning" : "info"} />
                    <StatusBadge label={member.active ? "Ativo" : "Inativo"} tone={member.active ? "success" : "warning"} />
                  </View>
                </View>

                <View style={styles.enterpriseList}>
                  {member.enterprises.map((enterprise) => {
                    const manageable = canManageEnterprise(role, enterprise);
                    const label = manageable ? "Gerenciavel" : "Somente visualizacao";
                    const tone = manageable ? "success" : "neutral";

                    return (
                      <View key={`${member.id}-${enterprise}`} style={styles.enterpriseRow}>
                        <Text style={styles.enterpriseName}>{enterprise}</Text>
                        <StatusBadge label={label} tone={tone} />
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
