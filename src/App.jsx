import React, { useState } from "react";
import Cotizador from "../cotizador_corte_plegado.jsx";
import GeneradorPerfil from "../generador_perfil_plegado.jsx";
import Welcome from "./Welcome.jsx";

const TOOLS = [
  { key: "cotizador", label: "Cotizador corte + plegado" },
  { key: "perfil", label: "Generador de perfil plegado" },
];

export default function App() {
  const [tool, setTool] = useState("cotizador");
  const [started, setStarted] = useState(false);

  if (!started) {
    return <Welcome onStart={() => setStarted(true)} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0c1b2a" }}>
      <nav
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          padding: "12px 16px",
          borderBottom: "1px solid #1c3a52",
          fontFamily: "'IBM Plex Sans','Segoe UI',system-ui,sans-serif",
        }}
      >
        <strong style={{ color: "#f2f7fb", marginRight: 8 }}>Plasmart</strong>
        {TOOLS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTool(t.key)}
            style={{
              background: tool === t.key ? "#1f5978" : "#12283d",
              border: "1px solid #21415c",
              color: tool === t.key ? "#f2f7fb" : "#a9c6d8",
              borderRadius: 6,
              padding: "7px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div style={{ padding: 20 }}>
        {tool === "cotizador" && <Cotizador />}
        {tool === "perfil" && <GeneradorPerfil />}
      </div>
    </div>
  );
}
