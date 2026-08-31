import React from "react";
import logoUrl from "./assets/plasmart-logo.png";

export default function Welcome({ onStart }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0c1b2a",
        color: "#f2f7fb",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
        boxSizing: "border-box",
        fontFamily: "'IBM Plex Sans','Segoe UI',system-ui,sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#0f2437",
          border: "1px solid #1c3a52",
          borderRadius: 14,
          padding: "32px 28px",
          boxSizing: "border-box",
          textAlign: "center",
        }}
      >
        <img
          src={logoUrl}
          alt="Plasmart"
          style={{ width: 84, height: 84, borderRadius: 12, marginBottom: 20 }}
        />

        <h1
          style={{
            fontSize: 21,
            fontWeight: 700,
            letterSpacing: 0.3,
            margin: "0 0 14px",
            lineHeight: 1.3,
          }}
        >
          BIENVENIDOS A COTIZADOR ONLINE DE PLASMART
        </h1>

        <p style={{ fontSize: 14.5, color: "#c9dbe8", lineHeight: 1.5, margin: "0 0 22px" }}>
          Aquí podrá generar una cotización online de su trabajo.
        </p>

        <div
          style={{
            background: "#12283d",
            border: "1px solid #21415c",
            borderRadius: 10,
            padding: "16px 18px",
            textAlign: "left",
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: 1.5,
              color: "#5fd0e0",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            A tener en cuenta
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "#a9c6d8", fontSize: 13.5, lineHeight: 1.6 }}>
            <li>
              Los valores cotizados aquí son orientativos y luego procesados por un asesor antes
              de comenzar el trabajo.
            </li>
            <li>
              El precio cotizado es por kilo y puede variar dependiendo la forma final de la
              pieza.
            </li>
          </ul>
        </div>

        <button
          onClick={onStart}
          style={{
            width: "100%",
            background: "#1f5978",
            border: "1px solid #2a6f8f",
            color: "#eafcff",
            borderRadius: 8,
            padding: "13px 18px",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Ingresar al cotizador
        </button>
      </div>
    </div>
  );
}
