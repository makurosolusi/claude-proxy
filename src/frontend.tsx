import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./custom.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { ModalsProvider } from "@mantine/modals";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";

const theme = createTheme({
  fontFamily: '"Geist", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  fontFamilyMonospace: '"Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", monospace',
  defaultRadius: "lg",
  focusRing: "auto",
  colors: {
    // Override blue to electric blue
    blue: [
      "#e8f0ff","#c5d6ff","#9db8ff","#6d94ff",
      "#3d6eff","#2563eb","#1d4ed8","#1e40af",
      "#1e3a8a","#1e3270",
    ],
  },
  primaryColor: "blue",
  primaryShade: 5,
  components: {
    Paper: {
      defaultProps: { radius: "xl" },
    },
    Badge: {
      defaultProps: { radius: "md" },
    },
    Button: {
      defaultProps: { radius: "lg" },
    },
    ActionIcon: {
      defaultProps: { radius: "lg" },
    },
  },
});

const Inspector = import.meta.env.DEV
  ? (await import("./DevInspector")).DevInspector
  : ({ children }: { children: ReactNode }) => <>{children}</>;

function Root() {
  return (
    <BrowserRouter>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <ModalsProvider>
          <Notifications position="top-center" containerWidth="min(400px, calc(100vw - 32px))" />
          <Inspector>
            <App />
          </Inspector>
        </ModalsProvider>
      </MantineProvider>
    </BrowserRouter>
  );
}

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <Root />
  </StrictMode>
);

if (import.meta.hot) {
  const root = (import.meta.hot.data.root ??= createRoot(elem));
  root.render(app);
} else {
  createRoot(elem).render(app);
}
