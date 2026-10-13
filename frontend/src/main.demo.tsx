import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "@fontsource-variable/figtree";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./context/ToastContext";
import { I18nProvider } from "./i18n";
import { installMockApi } from "./demo/mock";
import "./index.css";

installMockApi();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <I18nProvider><ThemeProvider><ToastProvider><AuthProvider><App /></AuthProvider></ToastProvider></ThemeProvider></I18nProvider>
    </HashRouter>
    <div className="fixed bottom-2 start-1/2 -translate-x-1/2 z-[90] rounded-full bg-ink text-canvas text-[12px] px-3 py-1 opacity-80 pointer-events-none">Demo edition: data lives in this tab and resets on reload</div>
  </React.StrictMode>
);
