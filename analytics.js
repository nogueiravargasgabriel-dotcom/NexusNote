"use strict";

/*
 * A análise principal está centralizada no app.js.
 * Este módulo apenas pede uma atualização dos dados quando o professor
 * volta para a aba do navegador, sem criar observadores duplicados.
 *
 * Observação: "state" no app.js é uma const de escopo global e NÃO fica
 * em window.state; por isso a tela ativa é verificada pelo DOM.
 */

(function () {
  const state = {
    initialized: false
  };

  function teacherScreenIsVisible() {
    const screen = document.getElementById("teacher-screen");
    return Boolean(screen) && !screen.hidden;
  }

  function initialize() {
    if (state.initialized) return;
    state.initialized = true;

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && teacherScreenIsVisible()) {
        document.dispatchEvent(new CustomEvent("nexusnote-analysis-refresh"));
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
