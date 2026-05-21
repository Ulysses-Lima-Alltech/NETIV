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

export default function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useAuthStore((state) => state.login);

  function handleLogin() {
    if (!username.trim() || !password.trim()) {
      Alert.alert("Atenção", "Informe usuário e senha.");
      return;
    }

    const result = login(username, password);

    if (!result.ok) {
      Alert.alert("Acesso negado", result.message ?? "Usuário ou senha inválidos.");
      return;
    }

    router.replace("/home");
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: "padding", android: undefined })}
    >
      <View style={styles.card}>
        <Text style={styles.title}>NETIV</Text>
        <Text style={styles.subtitle}>Acesso comercial</Text>

        <View style={styles.mockBox}>
          <Text style={styles.mockTitle}>Acessos de teste</Text>
          <Text style={styles.mockText}>corretor / corretor</Text>
          <Text style={styles.mockText}>gestor / gestor</Text>
          <Text style={styles.mockText}>admin / admin</Text>
        </View>

        <Text style={styles.label}>Usuário</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="Digite seu usuário"
          autoCapitalize="none"
          style={styles.input}
        />

        <Text style={styles.label}>Senha</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Digite sua senha"
          secureTextEntry
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
    backgroundColor: "#0F172A",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 22,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 4,
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: "#64748B",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 18,
  },
  mockBox: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 12,
    marginBottom: 18,
  },
  mockTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 4,
  },
  mockText: {
    fontSize: 12,
    color: "#475569",
    marginTop: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: "700",
    color: "#334155",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    fontSize: 16,
    backgroundColor: "#F8FAFC",
  },
  button: {
    backgroundColor: "#0F172A",
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 6,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
});