import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { VennbaseProvider } from "@vennbase/react";
import { App } from "./app/App";
import { db } from "./lib/db";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <VennbaseProvider db={db}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </VennbaseProvider>
  </React.StrictMode>,
);
