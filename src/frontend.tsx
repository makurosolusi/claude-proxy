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
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  defaultRadius: "md",
});

const Inspector = import.meta.env.DEV
  ? (await import("./DevInspector")).DevInspector
  : ({ children }: { children: ReactNode }) => <>{children}</>;

function Root() {
  return (
    <BrowserRouter>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <ModalsProvider>
          <Notifications position="top-right" />
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
