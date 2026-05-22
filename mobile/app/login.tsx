import { router } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuthStore } from "../src/stores/auth.store";
import { brand, colors, radius, shadows, spacing, typography } from "../src/theme";

const MOCK_ACCESS = ["corretor / corretor", "gestor / gestor", "admin / admin"];

export default function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useAuthStore((state) => state.login);

  function handleLogin() {
    if (!username.trim() || !password.trim()) {
      Alert.alert("Atencao", "Informe usuario e senha.");
      return;
    }

    const result = login(username, password);

    if (!result.ok) {
      Alert.alert("Acesso negado", result.message ?? "Usuario ou senha invalidos.");
      return;
    }

    router.replace("/home");
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: "padding", android: undefined })}
    >
      <View style={styles.headerBlock}>
        <Text style={styles.brand}>{brand.name}</Text>
        <Text style={styles.tagline}>{brand.tagline}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Acesso ao app mobile</Text>
        <Text style={styles.subtitle}>Entre com seu perfil para continuar.</Text>

        <View style={styles.mockBox}>
          <Text style={styles.mockTitle}>Credenciais de teste</Text>
          {MOCK_ACCESS.map((item) => (
            <Text key={item} style={styles.mockLine}>
              {item}
            </Text>
          ))}
        </View>

        <Text style={styles.label}>Usuario</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="Digite seu usuario"
          autoCapitalize="none"
          placeholderTextColor="#98A2B3"
          style={styles.input}
        />

        <Text style={styles.label}>Senha</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Digite sua senha"
          secureTextEntry
          placeholderTextColor="#98A2B3"
          style={styles.input}
        />

        <Pressable style={styles.button} onPress={handleLogin}>
          <Text style={styles.buttonText}>Entrar</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  headerBlock: {
    marginBottom: spacing.lg,
  },
  brand: {
    fontSize: 40,
    lineHeight: 44,
    fontWeight: "900",
    letterSpacing: 1.2,
    color: colors.navy,
  },
  tagline: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
    maxWidth: 320,
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.strong,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.navy,
  },
  subtitle: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  mockBox: {
    borderRadius: radius.md,
    backgroundColor: colors.blueSoft,
    borderWidth: 1,
    borderColor: "#D5E3FF",
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  mockTitle: {
    ...typography.cardTitle,
    color: colors.navy,
    marginBottom: spacing.xxs,
    fontSize: 14,
  },
  mockLine: {
    ...typography.body,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    ...typography.caption,
    color: colors.text,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    backgroundColor: "#FBFDFF",
    color: colors.text,
  },
  button: {
    marginTop: spacing.lg,
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.orange,
  },
  buttonText: {
    ...typography.cardTitle,
    color: "#FFFFFF",
  },
});
