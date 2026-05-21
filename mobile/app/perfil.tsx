import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function ProfileScreen() {
  function logout() {
    router.replace("/login");
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Meu perfil</Text>
        <Text style={styles.line}>Nome: Usuário de teste</Text>
        <Text style={styles.line}>Perfil: CORRETOR</Text>
        <Text style={styles.line}>Acesso: Mobile MVP</Text>

        <Pressable style={styles.button} onPress={logout}>
          <Text style={styles.buttonText}>Sair</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 18,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: "#0F172A",
    marginBottom: 16,
  },
  line: {
    fontSize: 16,
    color: "#334155",
    marginBottom: 8,
  },
  button: {
    backgroundColor: "#DC2626",
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 18,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    textAlign: "center",
    fontSize: 16,
  },
});
