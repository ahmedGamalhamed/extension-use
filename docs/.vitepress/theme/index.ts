import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import PackagePicker from "./components/PackagePicker.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("PackagePicker", PackagePicker);
  },
} satisfies Theme;
