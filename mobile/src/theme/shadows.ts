import { ViewStyle } from "react-native";

const cardBase: ViewStyle = {
  shadowColor: "#02111F",
  shadowOpacity: 0.05,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
};

const strongBase: ViewStyle = {
  shadowColor: "#02111F",
  shadowOpacity: 0.09,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 4,
};

export const shadows = {
  card: cardBase,
  strong: strongBase,
};
