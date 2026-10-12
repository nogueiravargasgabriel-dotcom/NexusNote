"use strict";

/* ==========================================================================
   NexusNote · app.js
   ========================================================================== */

const TABLE = "digital_notebooks";
const SUBMISSIONS_TABLE = "student_submissions";
const PROFILE_TABLE = "profiles";
const AVATAR_BUCKET = "avatars";
const NOTEBOOK_IMAGE_BUCKET = "notebook-images";
const REMEMBER_KEY = "nexusnote-remember-session";

const DEFAULT_SUMMARY_TITLE = "Meu resumo";
const DEFAULT_SUMMARY_PLACEHOLDER =
  "Escreva, com suas palavras, o que você compreendeu deste texto...";

/* Parâmetros da análise pedagógica (ajuste aqui, se necessário) */
const ANALYSIS = {
  masteryMin: 80,          // Domínio pleno: 80% a 100%
  consolidationMin: 50,    // Em consolidação: 50% a 79%
  highAccuracyMin: 50,     // "Alto acerto" para as categorias de aprendizagem
  richTextMinWords: 40,    // Texto elaborado: a partir de 40 palavras...
  richTextMinSentences: 2, // ...e pelo menos 2 frases
  pasteDominantRatio: 0.6, // Colagem predominante: 60% do texto final colado
  idleLimitMs: 120000      // Sem interação por 2 min: o tempo deixa de contar
};

const STAGES = {
  leitura: "Leitura",
  sintese: "Síntese",
  questoes: "Questões objetivas"
};

const SUBJECTS = {
  linguagens: {
    title: "Linguagens",
    icon: "✦",
    subjects: {
      arte: "Arte",
      "lingua-portuguesa": "Língua Portuguesa",
      "lingua-inglesa": "Língua Inglesa",
      literatura: "Literatura",
      "educacao-fisica": "Educação Física",
      "producao-textual": "Produção Textual"
    }
  },

  matematica: {
    title: "Matemática",
    icon: "∑",
    subjects: {
      matematica: "Matemática"
    }
  },

  natureza: {
    title: "Ciências da Natureza",
    icon: "⚛",
    subjects: {
      biologia: "Biologia",
      fisica: "Física",
      quimica: "Química"
    }
  },

  humanas: {
    title: "Ciências Humanas",
    icon: "◎",
    subjects: {
      geografia: "Geografia",
      sociologia: "Sociologia",
      historia: "História",
      filosofia: "Filosofia",
      "ensino-religioso": "Ensino Religioso"
    }
  }
};

const SUBJECT_NAMES = Object.values(SUBJECTS)
  .flatMap(area => Object.entries(area.subjects))
  .reduce((result, [id, name]) => {
    result[id] = name;
    return result;
  }, {});

const state = {
  user: null,
  profile: null,
  screen: "home-screen",
  subject: "",
  notebook: null,
  notebooks: [],
  submissions: [],
  blocks: [],          // blocos do caderno aberto pelo estudante
  builderBlocks: [],   // blocos do caderno em edição pelo professor
  questions: [],
  answers: {},
  score: null,
  authMode: "login",
  busy: false,
  activating: false,
  submissionBusy: false,
  toastTimer: null
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindNavigation();
  bindAuth();
  bindStudent();
  bindReader();
  bindProfile();
  bindTeacher();
  renderSubjects();
  renderSubjectOptions();
  renderBuilders();
  await restoreSession();
}

/* ==========================================================================
   Utilitários
   ========================================================================== */

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return [...document.querySelectorAll(selector)];
}

function text(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value ?? "";
}

function input(selector, value) {
  const element = $(selector);
  if (element) element.value = value ?? "";
}

function getValue(selector) {
  return $(selector)?.value.trim() || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function showScreen(id, updateHash = true) {
  const previous = state.screen;

  if (previous === "reader-screen" && id !== previous) {
    trackTick();
  }

  $$(".screen").forEach(screen => {
    screen.hidden = screen.id !== id;
  });

  state.screen = id;

  if (updateHash) {
    history.pushState({}, "", `#${id.replace("-screen", "")}`);
  }

  if (id === "reader-screen") {
    resumeTracking();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function defaultScreen() {
  if (!state.user) return "home-screen";
  return isTeacher() ? "teacher-screen" : "student-screen";
}

function resolveScreenFromHash() {
  const id = `${location.hash.replace("#", "") || "home"}-screen`;

  if (!document.getElementById(id)) return defaultScreen();

  if (["home-screen", "auth-screen"].includes(id)) return id;
  if (!state.user) return "home-screen";
  if (id === "teacher-screen" && !isTeacher()) return defaultScreen();
  if (id === "notebooks-screen" && !state.subject) return defaultScreen();
  if (id === "reader-screen" && !state.notebook) return defaultScreen();

  return id;
}

function bindNavigation() {
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-screen]");

    if (!button) return;

    if (button.dataset.authMode) {
      state.authMode = button.dataset.authMode;
      updateAuthMode();
    }

    showScreen(button.dataset.screen);
  });

  $("#session-label")?.addEventListener("click", openEnvironment);
  $("#logout-button")?.addEventListener("click", logout);

  window.addEventListener("popstate", () => {
    showScreen(resolveScreenFromHash(), false);
  });

  document.addEventListener("nexusnote-analysis-refresh", () => {
    if (state.screen === "teacher-screen" && $("#analysis-notebook")?.value) {
      loadAnalysis();
    }
  });
}

function openEnvironment() {
  if (!state.user) {
    showScreen("auth-screen");
    return;
  }

  if (isTeacher()) {
    showScreen("teacher-screen");
    loadTeacherEnvironment();
  } else {
    showScreen("student-screen");
  }
}

function isTeacher() {
  const role = String(state.profile?.role || "student").toLowerCase();

  return [
    "teacher",
    "professor",
    "admin",
    "administrator"
  ].includes(role);
}

/* ==========================================================================
   Autenticação
   ========================================================================== */

function bindAuth() {
  $("#auth-form")?.addEventListener("submit", authenticate);

  $$("[data-auth-mode]").forEach(button => {
    button.addEventListener("click", () => {
      state.authMode = button.dataset.authMode;
      updateAuthMode();
    });
  });

  $("#forgot-password")?.addEventListener("click", resetPassword);
  updateAuthMode();
}

function updateAuthMode() {
  const register = state.authMode === "register";

  $$("[data-auth-mode]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.authMode === state.authMode
    );
  });

  const wrapper = $("#auth-name-wrapper");
  const name = $("#auth-name");
  const submit = $("#auth-submit");

  if (wrapper) wrapper.hidden = !register;
  if (name) name.required = register;

  if (submit && !state.busy) {
    submit.textContent = register
      ? "Criar conta de estudante"
      : "Entrar";
  }
}

async function authenticate(event) {
  event.preventDefault();

  if (state.busy || !window.supabaseClient) return;

  const email = getValue("#auth-email");
  const password = getValue("#auth-password");
  const fullName = getValue("#auth-name");

  if (!email || !password) {
    text("#auth-status", "Informe o e-mail e a senha.");
    return;
  }

  /* A opção "Lembrar acesso" precisa ser gravada ANTES do login,
     pois o armazenamento da sessão (supabaseconfig.js) a consulta. */
  localStorage.setItem(
    REMEMBER_KEY,
    String($("#remember-session")?.checked !== false)
  );

  state.busy = true;
  $("#auth-submit").disabled = true;
  $("#auth-submit").textContent = "Processando...";
  text("#auth-status", "");

  try {
    if (state.authMode === "register") {
      const response = await window.supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            role: "student"
          }
        }
      });

      if (response.error) throw response.error;

      if (!response.data.session) {
        text(
          "#auth-status",
          "Cadastro realizado. Confirme seu e-mail para entrar."
        );
        return;
      }

      await activateSession(response.data.session);
    } else {
      const response = await window.supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (response.error) throw response.error;
      await activateSession(response.data.session);
    }
  } catch (error) {
    console.error(error);
    text("#auth-status", authError(error));
  } finally {
    state.busy = false;
    $("#auth-submit").disabled = false;
    updateAuthMode();
  }
}

async function restoreSession() {
  if (!window.supabaseClient) return;

  const response = await window.supabaseClient.auth.getSession();

  if (response.data.session) {
    await activateSession(response.data.session);
  }

  window.supabaseClient.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(async () => {
      if (session && !state.user) {
        await activateSession(session);
      }

      if (!session && state.user) {
        clearSession();
      }
    }, 0);
  });
}

async function activateSession(session) {
  if (!session?.user || state.activating) return;

  state.activating = true;

  try {
    state.user = session.user;

    const response = await window.supabaseClient
      .from(PROFILE_TABLE)
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();

    state.profile = response.data || {
      id: session.user.id,
      full_name: session.user.user_metadata?.full_name ||
        session.user.email ||
        "Usuário",
      role: "student"
    };

    const name = state.profile.full_name ||
      session.user.email ||
      "Usuário";

    text("#session-label", name);
    text("#student-profile-name", name);
    text("#student-avatar-small", name.charAt(0).toUpperCase());

    $("#session-label").hidden = false;
    $("#logout-button").hidden = false;

    renderProfile();

    if (isTeacher()) {
      showScreen("teacher-screen");
      await loadTeacherEnvironment();
    } else {
      showScreen("student-screen");
    }
  } finally {
    state.activating = false;
  }
}

function clearSession() {
  stopTracking();

  state.user = null;
  state.profile = null;
  state.notebook = null;
  state.notebooks = [];
  state.submissions = [];
  state.blocks = [];
  state.builderBlocks = [];
  state.questions = [];
  state.answers = {};
  state.score = null;
  state.subject = "";

  $("#session-label").hidden = true;
  $("#logout-button").hidden = true;

  renderBuilders();
  showScreen("home-screen", false);
}

async function logout() {
  await window.supabaseClient?.auth.signOut();
  clearSession();
}

async function resetPassword() {
  const email = getValue("#auth-email");

  if (!email) {
    text("#auth-status", "Informe o e-mail primeiro.");
    return;
  }

  const response = await window.supabaseClient.auth.resetPasswordForEmail(
    email,
    { redirectTo: window.location.href }
  );

  text(
    "#auth-status",
    response.error
      ? "Não foi possível enviar o e-mail."
      : "Verifique sua caixa de entrada."
  );
}

function authError(error) {
  const message = String(error?.message || "").toLowerCase();

  if (
    message.includes("invalid login") ||
    message.includes("invalid credentials")
  ) {
    return "E-mail ou senha incorretos.";
  }

  if (message.includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar.";
  }

  if (message.includes("already registered")) {
    return "Este e-mail já possui uma conta.";
  }

  return error?.message || "Não foi possível concluir o acesso.";
}

/* ==========================================================================
   Matérias e cadernos (estudante)
   ========================================================================== */

function renderSubjects() {
  const target = $("#subject-grid");
  if (!target) return;

  target.innerHTML = Object.entries(SUBJECTS)
    .map(([, area]) => `
      <section class="subject-area">
        <header class="subject-area-heading">
          <span class="area-icon">${escapeHtml(area.icon)}</span>
          <div>
            <span class="eyebrow">${escapeHtml(area.title)}</span>
            <h2>${escapeHtml(area.title)}</h2>
          </div>
        </header>

        <div class="subject-list">
          ${Object.entries(area.subjects).map(([id, name]) => `
            <button class="subject-card" type="button" data-subject="${escapeAttribute(id)}">
              <b>${escapeHtml(getSubjectIcon(id))}</b>
              <span>
                ${escapeHtml(name)}
                <small>Acessar cadernos</small>
              </span>
            </button>
          `).join("")}
        </div>
      </section>
    `)
    .join("");
}

function getSubjectIcon(id) {
  const icons = {
    arte: "◈",
    "lingua-portuguesa": "Aa",
    "lingua-inglesa": "En",
    literatura: "✎",
    "educacao-fisica": "⚽",
    "producao-textual": "文",
    matematica: "∑",
    biologia: "🧬",
    fisica: "Φ",
    quimica: "⚗",
    geografia: "⌖",
    sociologia: "♧",
    historia: "⌛",
    filosofia: "☼",
    "ensino-religioso": "✧"
  };

  return icons[id] || "N";
}

function renderSubjectOptions() {
  const select = $("#notebook-subject");
  if (!select) return;

  select.innerHTML = `
    <option value="">Selecione o componente</option>
    ${Object.entries(SUBJECT_NAMES).map(([id, name]) => `
      <option value="${escapeAttribute(id)}">${escapeHtml(name)}</option>
    `).join("")}
  `;
}

function bindStudent() {
  document.addEventListener("click", event => {
    const subject = event.target.closest("[data-subject]");
    const notebook = event.target.closest("[data-open-notebook]");

    if (subject) {
      state.subject = subject.dataset.subject;
      loadStudentNotebooks();
    }

    if (notebook) {
      openNotebook(notebook.dataset.openNotebook);
    }
  });
}

async function loadStudentNotebooks() {
  showScreen("notebooks-screen");
  text("#selected-subject", SUBJECT_NAMES[state.subject] || "");

  const target = $("#student-notebooks");
  target.innerHTML = `<div class="empty-state">Carregando cadernos...</div>`;

  const response = await window.supabaseClient
    .from(TABLE)
    .select("*")
    .eq("subject_id", state.subject)
    .eq("published", true)
    .order("created_at", { ascending: false });

  if (response.error) {
    console.error(response.error);
    target.innerHTML = `<div class="empty-state">Não foi possível carregar os cadernos.</div>`;
    return;
  }

  target.innerHTML = response.data?.length
    ? response.data.map(renderStudentNotebook).join("")
    : `<div class="empty-state">Nenhum caderno publicado para esta matéria.</div>`;
}

function renderStudentNotebook(notebook) {
  return `
    <article class="notebook-card">
      <div>
        <span class="eyebrow">${escapeHtml(SUBJECT_NAMES[notebook.subject_id] || "")}</span>
        <h2>${escapeHtml(notebook.title)}</h2>
        <p>${escapeHtml(notebook.description || "")}</p>
        <small>Turma: ${escapeHtml(notebook.class_name || "Não informada")}</small>
      </div>

      <button class="primary-button" type="button" data-open-notebook="${escapeAttribute(notebook.id)}">
        Abrir caderno
      </button>
    </article>
  `;
}

/* ==========================================================================
   Leitor do caderno (estudante)
   ========================================================================== */

function bindReader() {
  $("#reader-back")?.addEventListener("click", loadStudentNotebooks);
  $("#student-notes")?.addEventListener("input", saveStudentNotes);

  $("#student-name")?.addEventListener("input", event => {
    localStorage.setItem("nexusnote-student-name", event.target.value);
  });

  $("#check-answers")?.addEventListener("click", evaluateAnswers);
  $("#send-submission")?.addEventListener("click", sendSubmission);
  $("#generate-report")?.addEventListener("click", generateReport);
  $("#download-report")?.addEventListener("click", downloadReport);
  $("#download-mind-map")?.addEventListener("click", downloadMindMap);
  $("#download-mind-map-png")?.addEventListener("click", downloadMindMapPng);
  $("#share-whatsapp")?.addEventListener("click", shareWhatsApp);

  bindTracking();
}

async function openNotebook(id) {
  const response = await window.supabaseClient
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq("published", true)
    .single();

  if (response.error || !response.data) {
    showToast("Não foi possível abrir o caderno.");
    return;
  }

  state.notebook = response.data;
  state.answers = {};
  state.score = null;
  state.blocks = normalizeBlocks(response.data.activity_blocks);

  if (!state.blocks.length && response.data.content) {
    state.blocks = createTextWithSummary(response.data.content);
  }

  state.blocks = ensureSummaryBlocks(state.blocks);

  text("#answer-result", "");
  text("#submission-status", "");
  text("#notes-status", "");
  text("#student-summary", "");
  $("#mind-map").innerHTML = "";

  renderReader();
  loadStudentLocalData();
  startTracking(state.notebook.id);
  showScreen("reader-screen");
}

/* ---------- Blocos ---------- */

function normalizeBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];

  return blocks.map(block => {
    let type = block.type || "teacher_text";

    /* Cadernos antigos: o bloco de anotações vira bloco de resumo. */
    if (type === "student_notes") type = "student_summary";

    const isSummary = type === "student_summary";
    const legacyTitle = block.title === "Bloco de anotações";

    return {
      id: block.id || crypto.randomUUID(),
      type,
      text: block.text || "",
      image_url: block.image_url || null,
      linked_to: block.linked_to || null,
      title: isSummary
        ? (block.title && !legacyTitle ? block.title : DEFAULT_SUMMARY_TITLE)
        : (block.title || ""),
      placeholder: block.placeholder || DEFAULT_SUMMARY_PLACEHOLDER,
      statement: block.statement || "",
      command: block.command || "",
      options: Array.isArray(block.options)
        ? block.options.map((option, index) => ({
            letter: option.letter || String.fromCharCode(65 + index),
            text: option.text || "",
            correct: Boolean(option.correct)
          }))
        : []
    };
  });
}

function makeSummaryBlock(linkedTo, id = crypto.randomUUID()) {
  return {
    id,
    type: "student_summary",
    linked_to: linkedTo,
    title: DEFAULT_SUMMARY_TITLE,
    placeholder: DEFAULT_SUMMARY_PLACEHOLDER,
    text: ""
  };
}

/* Um único "Adicionar texto" cria o texto do professor
   e, logo abaixo, o box de resumo do estudante. */
function createTextWithSummary(content = "") {
  const textBlock = {
    id: crypto.randomUUID(),
    type: "teacher_text",
    text: content,
    image_url: null
  };

  return [textBlock, makeSummaryBlock(textBlock.id)];
}

/* Cadernos antigos sem nenhum box de resumo recebem um box
   automático abaixo de cada texto. */
function ensureSummaryBlocks(blocks) {
  if (blocks.some(block => block.type === "student_summary")) {
    return blocks;
  }

  const result = [];

  blocks.forEach(block => {
    result.push(block);

    if (block.type === "teacher_text") {
      result.push(makeSummaryBlock(block.id, `auto-${block.id}`));
    }
  });

  return result;
}

/* ---------- Renderização ---------- */

function renderReader() {
  const notebook = state.notebook;

  text("#reader-subject", SUBJECT_NAMES[notebook.subject_id] || "");
  text("#reader-title", notebook.title);
  text("#reader-description", notebook.description);

  const info = [
    ["Turma", notebook.class_name],
    ["Prazo", formatDate(notebook.deadline)],
    ["Objetivo", notebook.learning_objective],
    ["Competências", notebook.competencies],
    ["Palavras-chave", notebook.keywords],
    ["Orientações", notebook.student_instructions]
  ].filter(([, value]) => value);

  $("#reader-information").innerHTML = info.length
    ? info.map(([title, value]) => `
        <article class="information-card">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(value)}</p>
        </article>
      `).join("")
    : "";

  renderReaderBlocks();
  markReaderStages();
}

function markReaderStages() {
  const stages = [
    ["#reader-screen .reader-header", "leitura"],
    ["#reader-information", "leitura"],
    ["#reader-screen .notes-section", "sintese"],
    ["#questions-section", "questoes"],
    ["#reader-screen .report-section", "sintese"]
  ];

  stages.forEach(([selector, stage]) => {
    $(selector)?.setAttribute("data-stage", stage);
  });
}

function renderReaderBlocks() {
  const content = $("#reader-content");
  const questions = [];
  const textNumbers = {};
  let textCount = 0;

  content.innerHTML = state.blocks.map(block => {
    if (block.type === "question") {
      questions.push(block);
      return "";
    }

    if (block.type === "student_summary") {
      const number = textNumbers[block.linked_to];

      return `
        <article class="reader-block summary-block" data-stage="sintese">
          <span class="block-label">${number ? `Resumo do texto ${number}` : "Resumo"}</span>
          <h3>${escapeHtml(block.title || DEFAULT_SUMMARY_TITLE)}</h3>
          <textarea
            class="student-summary-input"
            data-summary-id="${escapeAttribute(block.id)}"
            rows="6"
            placeholder="${escapeAttribute(block.placeholder || DEFAULT_SUMMARY_PLACEHOLDER)}"
          ></textarea>
          <small class="summary-meter">0 palavras · 0 caracteres · 0 parágrafos</small>
        </article>
      `;
    }

    textCount++;
    textNumbers[block.id] = textCount;

    return `
      <article class="reader-block teacher-text-block" data-stage="leitura">
        <span class="block-label">Texto ${textCount}</span>
        ${formatText(block.text)}
        ${
          block.image_url
            ? `<img src="${escapeAttribute(block.image_url)}" alt="Imagem inserida pelo professor">`
            : ""
        }
      </article>
    `;
  }).join("");

  state.questions = questions;
  renderQuestions();

  $$(".student-summary-input").forEach(field => {
    const id = field.dataset.summaryId;
    const key = summaryStorageKey(id);
    const legacyKey = `nexusnote-block-${state.notebook.id}-${id}`;

    field.value = localStorage.getItem(key) ||
      localStorage.getItem(legacyKey) ||
      "";

    updateSummaryMeter(field);

    field.addEventListener("input", () => {
      localStorage.setItem(key, field.value);
      updateSummaryMeter(field);
    });
  });
}

function summaryStorageKey(blockId) {
  return `nexusnote-summary-${state.notebook.id}-${blockId}`;
}

function updateSummaryMeter(field) {
  const meter = field.parentElement?.querySelector(".summary-meter");
  if (!meter) return;

  const stats = textStats(field.value);

  meter.textContent =
    `${stats.words} ${stats.words === 1 ? "palavra" : "palavras"} · ` +
    `${stats.chars} caracteres · ` +
    `${stats.paragraphs} ${stats.paragraphs === 1 ? "parágrafo" : "parágrafos"}`;
}

function renderQuestions() {
  const section = $("#questions-section");
  const target = $("#student-questions");

  if (!state.questions.length) {
    section.hidden = true;
    target.innerHTML = "";
    return;
  }

  section.hidden = false;

  target.innerHTML = state.questions.map((question, index) => `
    <fieldset class="question-card">
      <legend>${index + 1}. ${escapeHtml(question.statement)}</legend>

      ${
        question.command
          ? `<p class="question-command">${escapeHtml(question.command)}</p>`
          : ""
      }

      ${question.options.map(option => `
        <label class="question-option">
          <input
            type="radio"
            name="student-question-${index}"
            value="${escapeAttribute(option.letter)}"
          >
          <span>
            <strong>${escapeHtml(option.letter)})</strong>
            ${escapeHtml(option.text)}
          </span>
        </label>
      `).join("")}
    </fieldset>
  `).join("");
}

function evaluateAnswers() {
  let correct = 0;

  state.answers = {};

  state.questions.forEach((question, index) => {
    const selected = document.querySelector(
      `input[name="student-question-${index}"]:checked`
    );

    state.answers[index] = selected?.value || "";

    const answer = question.options.find(option => option.correct)?.letter;

    if (selected?.value && answer === selected.value) {
      correct++;
    }
  });

  state.score = {
    correct,
    total: state.questions.length
  };

  text(
    "#answer-result",
    `Resultado: ${correct} de ${state.questions.length} questão(ões) correta(s).`
  );
}

/* ---------- Anotações e textos do estudante ---------- */

function getSummaryEntries() {
  return $$(".student-summary-input").map(field => {
    const block = state.blocks.find(item => item.id === field.dataset.summaryId);

    return {
      id: field.dataset.summaryId,
      title: block?.title || DEFAULT_SUMMARY_TITLE,
      linkedTo: block?.linked_to || null,
      text: field.value.trim()
    };
  });
}

function getGeneralNotes() {
  return getValue("#student-notes");
}

function getAllStudentNotes() {
  const notes = getSummaryEntries()
    .filter(entry => entry.text)
    .map(entry => entry.text);

  const general = getGeneralNotes();
  if (general) notes.push(general);

  return notes;
}

/* Texto analisado como "síntese": os boxes de resumo; se o caderno
   não tiver nenhum, usa as anotações gerais. */
function getSynthesisText() {
  const summaries = getSummaryEntries()
    .filter(entry => entry.text)
    .map(entry => entry.text);

  return summaries.length ? summaries.join("\n\n") : getGeneralNotes();
}

function calculateProgress() {
  let progress = 20;

  if (state.notebook?.description) progress += 15;
  if (getAllStudentNotes().length) progress += 25;

  if (state.questions.length) {
    const answered = Object.values(state.answers).filter(Boolean).length;
    progress += Math.round(answered / state.questions.length * 20);

    if (state.score) {
      progress += Math.round(
        state.score.correct / state.score.total * 20
      );
    }
  } else {
    progress += 40;
  }

  return Math.min(progress, 100);
}

function saveStudentNotes() {
  if (!state.notebook) return;

  localStorage.setItem(
    `nexusnote-notes-${state.notebook.id}`,
    getValue("#student-notes")
  );

  text("#notes-status", "Anotação salva automaticamente.");
}

function loadStudentLocalData() {
  input(
    "#student-notes",
    localStorage.getItem(`nexusnote-notes-${state.notebook.id}`) || ""
  );

  input(
    "#student-name",
    localStorage.getItem("nexusnote-student-name") ||
      state.profile?.full_name ||
      ""
  );
}

/* ==========================================================================
   Rastreamento de comportamento (tempo por etapa e edição textual)
   ========================================================================== */

const TRACKED_FIELDS = ".student-summary-input, #student-notes";

const tracker = {
  data: null,
  key: "",
  stage: "leitura",
  last: 0,
  activity: 0,
  ticks: 0,
  timer: null,
  observer: null
};

function freshTracking(notebookId) {
  return {
    version: 1,
    notebook_id: notebookId,
    stage_ms: { leitura: 0, sintese: 0, questoes: 0 },
    editing: {
      paste_events: 0,
      pasted_chars: 0,
      deletions: 0,
      insertions: 0,
      input_events: 0
    }
  };
}

function bindTracking() {
  ["pointerdown", "keydown", "scroll", "touchstart", "wheel", "input"]
    .forEach(name => {
      window.addEventListener(
        name,
        () => { tracker.activity = Date.now(); },
        { passive: true, capture: true }
      );
    });

  /* Etapa ativa: o foco em um campo define em que etapa o estudante está. */
  document.addEventListener("focusin", event => {
    if (!tracker.data) return;

    if (event.target.closest?.(TRACKED_FIELDS)) {
      tracker.stage = "sintese";
    } else if (event.target.closest?.("#questions-section")) {
      tracker.stage = "questoes";
    }
  });

  document.addEventListener("input", event => {
    if (!tracker.data || !event.target.matches?.(TRACKED_FIELDS)) return;

    const editing = tracker.data.editing;
    const kind = event.inputType || "";

    editing.input_events++;

    if (kind.startsWith("delete")) {
      editing.deletions++;
    } else if (kind === "insertFromPaste" || kind === "insertFromDrop") {
      /* contabilizado nos eventos paste/drop */
    } else if (kind.startsWith("insert")) {
      editing.insertions += event.data ? event.data.length : 1;
    }
  });

  document.addEventListener("paste", event => {
    if (!tracker.data || !event.target.matches?.(TRACKED_FIELDS)) return;

    const pasted = event.clipboardData?.getData("text") || "";

    tracker.data.editing.paste_events++;
    tracker.data.editing.pasted_chars += pasted.length;
  });

  document.addEventListener("drop", event => {
    if (!tracker.data || !event.target.matches?.(TRACKED_FIELDS)) return;

    const dropped = event.dataTransfer?.getData("text") || "";

    if (dropped) {
      tracker.data.editing.paste_events++;
      tracker.data.editing.pasted_chars += dropped.length;
    }
  });

  document.addEventListener("visibilitychange", () => {
    tracker.last = Date.now();
    if (document.hidden) persistTracking();
  });

  window.addEventListener("pagehide", persistTracking);
}

function startTracking(notebookId) {
  stopTracking();

  tracker.key = `nexusnote-track-${notebookId}-${state.user?.id || "anon"}`;

  const fresh = freshTracking(notebookId);
  let saved = null;

  try {
    saved = JSON.parse(localStorage.getItem(tracker.key) || "null");
  } catch {
    saved = null;
  }

  tracker.data = saved?.version === 1
    ? {
        ...fresh,
        stage_ms: { ...fresh.stage_ms, ...saved.stage_ms },
        editing: { ...fresh.editing, ...saved.editing }
      }
    : fresh;

  tracker.stage = "leitura";
  tracker.last = Date.now();
  tracker.activity = Date.now();
  tracker.ticks = 0;
  tracker.timer = window.setInterval(trackTick, 1000);

  observeStages();
}

function resumeTracking() {
  if (!tracker.data) return;

  tracker.last = Date.now();
  tracker.activity = Date.now();
}

function stopTracking() {
  persistTracking();

  window.clearInterval(tracker.timer);
  tracker.observer?.disconnect();

  tracker.timer = null;
  tracker.observer = null;
  tracker.data = null;
}

function persistTracking() {
  if (!tracker.data || !tracker.key) return;

  try {
    localStorage.setItem(tracker.key, JSON.stringify(tracker.data));
  } catch {
    /* armazenamento indisponível: o rastreamento continua em memória */
  }
}

function trackTick() {
  const now = Date.now();
  const delta = Math.min(now - tracker.last, 5000);

  tracker.last = now;

  if (!tracker.data) return;
  if (document.hidden || state.screen !== "reader-screen") return;
  if (now - tracker.activity > ANALYSIS.idleLimitMs) return;

  tracker.data.stage_ms[tracker.stage] += delta;
  tracker.ticks++;

  if (tracker.ticks % 5 === 0) persistTracking();
}

/* A etapa também é detectada pela seção que ocupa o centro da tela. */
function observeStages() {
  tracker.observer?.disconnect();

  if (!("IntersectionObserver" in window)) return;

  tracker.observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.target.dataset.stage) {
        tracker.stage = entry.target.dataset.stage;
      }
    });
  }, { rootMargin: "-45% 0px -45% 0px" });

  $$("#reader-screen [data-stage]").forEach(element => {
    tracker.observer.observe(element);
  });
}

function textStats(value) {
  const clean = String(value || "").trim();

  if (!clean) {
    return {
      words: 0,
      chars: 0,
      chars_no_space: 0,
      paragraphs: 0,
      line_breaks: 0,
      sentences: 0
    };
  }

  return {
    words: clean.split(/\s+/).filter(Boolean).length,
    chars: clean.length,
    chars_no_space: clean.replace(/\s/g, "").length,
    paragraphs: clean.split(/\n\s*\n/).filter(part => part.trim()).length,
    line_breaks: (clean.match(/\n/g) || []).length,
    sentences: clean.split(/[.!?…]+(?:\s|$)/).filter(part => part.trim()).length
  };
}

function buildMetrics() {
  if (!tracker.data) return null;

  const stats = textStats(getSynthesisText());
  const editing = tracker.data.editing;
  const pasteRatio = stats.chars
    ? Math.min(editing.pasted_chars / stats.chars, 1)
    : 0;

  const seconds = ms => Math.round(ms / 1000);

  return {
    version: 1,
    stage_seconds: {
      leitura: seconds(tracker.data.stage_ms.leitura),
      sintese: seconds(tracker.data.stage_ms.sintese),
      questoes: seconds(tracker.data.stage_ms.questoes)
    },
    text: stats,
    editing: {
      paste_events: editing.paste_events,
      pasted_chars: editing.pasted_chars,
      paste_ratio: Math.round(pasteRatio * 100) / 100,
      paste_dominant:
        editing.paste_events > 0 &&
        stats.chars >= 100 &&
        pasteRatio >= ANALYSIS.pasteDominantRatio,
      deletions: editing.deletions,
      insertions: editing.insertions,
      input_events: editing.input_events,
      deletion_rate:
        Math.round(editing.deletions / Math.max(editing.insertions, 1) * 100) / 100
    },
    summary_blocks: state.blocks.filter(
      block => block.type === "student_summary"
    ).length
  };
}

/* ==========================================================================
   Envio ao professor
   ========================================================================== */

async function sendSubmission() {
  if (!state.notebook || state.submissionBusy) return;

  const studentCode = getValue("#student-code");
  const studentName = getValue("#student-name");

  if (!studentCode) {
    text("#submission-status", "Informe o código de identificação.");
    return;
  }

  /* Sempre corrige de novo: o estudante pode ter alterado as respostas. */
  if (state.questions.length) {
    evaluateAnswers();
  }

  state.submissionBusy = true;
  $("#send-submission").disabled = true;
  text("#submission-status", "Enviando informações...");

  trackTick();
  persistTracking();

  const payload = {
    notebook_id: state.notebook.id,
    student_id: state.user?.id || null,
    student_code: studentCode,
    student_name: studentName || null,
    notes: getAllStudentNotes().join("\n\n") || null,
    answers: state.answers,
    score: state.score?.correct ?? null,
    total_questions: state.score?.total ?? state.questions.length,
    progress: calculateProgress(),
    generated_summary: buildSummary(),
    metrics: buildMetrics()
  };

  const insert = body => window.supabaseClient
    .from(SUBMISSIONS_TABLE)
    .insert(body);

  let response = await insert(payload);
  let withoutMetrics = false;

  /* Banco ainda sem a coluna "metrics": envia sem ela. */
  if (response.error && /metrics/i.test(response.error.message || "")) {
    const { metrics, ...legacyPayload } = payload;
    response = await insert(legacyPayload);
    withoutMetrics = !response.error;
  }

  state.submissionBusy = false;
  $("#send-submission").disabled = false;

  if (response.error) {
    console.error(response.error);
    text("#submission-status", "Não foi possível enviar as informações.");
    return;
  }

  text(
    "#submission-status",
    "Informações enviadas ao professor com sucesso."
  );

  showToast(
    withoutMetrics
      ? "Envio concluído. A coluna 'metrics' ainda não existe no banco."
      : "Envio concluído com sucesso."
  );
}

/* ==========================================================================
   Síntese: resumo estruturado, mapa mental e relatório
   ========================================================================== */

function splitList(value, separator = /[,;\n]+/) {
  const items = String(value || "")
    .split(separator)
    .map(item => item.trim())
    .filter(Boolean);

  return [...new Set(items)];
}

function keySentences(value, count) {
  const paragraphs = String(value || "")
    .split(/\n+/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);

  const sentencesOf = paragraph =>
    (paragraph.match(/[^.!?…]+[.!?…]*/g) || [paragraph])
      .map(sentence => sentence.trim())
      .filter(sentence => sentence.length > 12);

  const result = [];

  if (paragraphs.length > 1) {
    paragraphs.forEach(paragraph => {
      const first = sentencesOf(paragraph)[0];
      if (first) result.push(first);
    });
  } else if (paragraphs.length === 1) {
    result.push(...sentencesOf(paragraphs[0]));
  }

  return result.slice(0, count).map(sentence => shorten(sentence, 130));
}

function wrapText(value, maxChars, maxLines = 2) {
  const words = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) lines.push(line);

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = shorten(
      `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`,
      maxChars
    );
    return kept;
  }

  return lines.length ? lines : [""];
}

function buildStudyModel() {
  const notebook = state.notebook;

  const teacherTexts = state.blocks.filter(
    block => block.type === "teacher_text" && block.text.trim()
  );

  const score = state.score
    ? {
        correct: state.score.correct,
        total: state.score.total,
        pct: state.score.total
          ? Math.round(state.score.correct / state.score.total * 100)
          : null
      }
    : null;

  if (score) score.band = accuracyBand(score.pct);

  return {
    title: notebook.title || "Caderno",
    subject: SUBJECT_NAMES[notebook.subject_id] || "",
    className: notebook.class_name || "",
    deadline: formatDate(notebook.deadline),
    description: notebook.description || "",
    objective: notebook.learning_objective || "",
    competencies: splitList(notebook.competencies, /\n|;/),
    keywords: splitList(notebook.keywords),
    concepts: teacherTexts.flatMap(block => keySentences(block.text, 2)).slice(0, 6),
    summaries: getSummaryEntries().filter(entry => entry.text),
    notes: getGeneralNotes(),
    student: getValue("#student-name") || state.profile?.full_name || "",
    generatedAt: new Date(),
    score,
    progress: calculateProgress()
  };
}

/* ---------- Texto simples (banco de dados e WhatsApp) ---------- */

function buildSummary() {
  const model = buildStudyModel();
  const lines = [];

  lines.push(`RESUMO DE ESTUDO · ${model.title}`);
  lines.push(
    [model.subject, model.className && `Turma ${model.className}`]
      .filter(Boolean)
      .join(" | ")
  );

  if (model.objective) {
    lines.push("", "OBJETIVO DE APRENDIZAGEM", model.objective);
  }

  if (model.keywords.length) {
    lines.push("", "PALAVRAS-CHAVE", model.keywords.join(", "));
  }

  if (model.concepts.length) {
    lines.push(
      "",
      "IDEIAS CENTRAIS",
      ...model.concepts.map((concept, index) => `${index + 1}. ${concept}`)
    );
  }

  if (model.summaries.length) {
    lines.push("", "MINHA SÍNTESE");

    model.summaries.forEach(summary => {
      lines.push(`${summary.title}:`, summary.text, "");
    });

    if (lines[lines.length - 1] === "") lines.pop();
  }

  if (model.notes) {
    lines.push("", "ANOTAÇÕES GERAIS", model.notes);
  }

  lines.push(
    "",
    "DESEMPENHO",
    model.score
      ? `${model.score.correct} de ${model.score.total} questões corretas (${model.score.pct ?? 0}%)`
      : "Questões ainda não corrigidas.",
    `Progresso estimado: ${model.progress}%`
  );

  return lines.join("\n").trim();
}

/* ---------- Resumo estruturado (tela e relatório) ---------- */

function paragraphsHtml(value) {
  return String(value || "")
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function summaryMarkup(model, { header = true } = {}) {
  const meta = [
    ["Estudante", model.student],
    ["Componente", model.subject],
    ["Turma", model.className],
    ["Prazo", model.deadline]
  ].filter(([, value]) => value);

  const parts = [];

  if (header) {
    parts.push(`
      <header class="ns-doc-head">
        <div>
          <span class="ns-kicker">Resumo de estudo</span>
          <h3>${escapeHtml(model.title)}</h3>
          ${model.description ? `<p>${escapeHtml(shorten(model.description, 220))}</p>` : ""}
        </div>

        <dl class="ns-meta">
          ${meta.map(([label, value]) => `
            <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>
          `).join("")}
        </dl>
      </header>
    `);
  }

  if (model.objective) {
    parts.push(`
      <section class="ns-block">
        <h4>Objetivo de aprendizagem</h4>
        <p>${escapeHtml(model.objective)}</p>
      </section>
    `);
  }

  if (model.keywords.length) {
    parts.push(`
      <section class="ns-block">
        <h4>Palavras-chave</h4>
        <ul class="ns-chips">
          ${model.keywords.map(word => `<li>${escapeHtml(word)}</li>`).join("")}
        </ul>
      </section>
    `);
  }

  if (model.competencies.length) {
    parts.push(`
      <section class="ns-block">
        <h4>Competências e habilidades</h4>
        <ul class="ns-list">
          ${model.competencies.map(item => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
    `);
  }

  if (model.concepts.length) {
    parts.push(`
      <section class="ns-block">
        <h4>Ideias centrais do texto</h4>
        <ol class="ns-points">
          ${model.concepts.map(item => `<li>${escapeHtml(item)}</li>`).join("")}
        </ol>
      </section>
    `);
  }

  parts.push(`
    <section class="ns-block ns-synthesis">
      <h4>Minha síntese</h4>
      ${
        model.summaries.length
          ? model.summaries.map(summary => `
              <article>
                <h5>${escapeHtml(summary.title)}</h5>
                ${paragraphsHtml(summary.text)}
              </article>
            `).join("")
          : `<p class="ns-empty">Escreva seu resumo nos boxes do caderno e gere o relatório novamente.</p>`
      }
    </section>
  `);

  if (model.notes) {
    parts.push(`
      <section class="ns-block">
        <h4>Anotações gerais</h4>
        ${paragraphsHtml(model.notes)}
      </section>
    `);
  }

  parts.push(`
    <section class="ns-block ns-performance">
      <h4>Desempenho</h4>
      <div class="ns-stats">
        <div>
          <strong>${model.score ? `${model.score.correct}/${model.score.total}` : "—"}</strong>
          <span>${model.score ? `questões corretas (${model.score.pct ?? 0}%)` : "questões ainda não corrigidas"}</span>
        </div>
        <div>
          <strong>${model.progress}%</strong>
          <span>progresso estimado</span>
        </div>
      </div>
      <div class="ns-progress"><span style="width:${model.progress}%"></span></div>
    </section>
  `);

  return parts.join("");
}

/* ---------- Mapa mental em SVG (identidade visual NexusNote) ---------- */

const MAP_FONT = "'Space Grotesk','Manrope',Arial,sans-serif";
const MAP_BODY_FONT = "'Manrope',Arial,sans-serif";

function mindMapBranches(model) {
  const branches = [];

  if (model.objective) {
    branches.push({ label: "Objetivo", color: "#32d6ff", items: [model.objective] });
  }

  if (model.keywords.length) {
    branches.push({ label: "Palavras-chave", color: "#61e4b2", items: model.keywords.slice(0, 6) });
  }

  if (model.competencies.length) {
    branches.push({ label: "Competências", color: "#ffd166", items: model.competencies.slice(0, 4) });
  }

  if (model.concepts.length) {
    branches.push({ label: "Ideias centrais", color: "#7c6cff", items: model.concepts.slice(0, 5) });
  }

  const mine = model.summaries
    .flatMap(summary => keySentences(summary.text, 2))
    .slice(0, 5);

  branches.push({
    label: "Minha síntese",
    color: "#ff8d9b",
    items: mine.length
      ? mine
      : ["Escreva seu resumo nos boxes do caderno para completar este ramo."]
  });

  branches.push({
    label: "Desempenho",
    color: "#61e4b2",
    items: [
      model.score
        ? `${model.score.correct} de ${model.score.total} questões corretas (${model.score.pct ?? 0}%)`
        : "Questões ainda não corrigidas",
      ...(model.score ? [`Faixa: ${model.score.band.label}`] : []),
      `Progresso estimado: ${model.progress}%`
    ]
  });

  if (branches.length === 2 && model.description) {
    branches.unshift({
      label: "Descrição",
      color: "#32d6ff",
      items: [model.description]
    });
  }

  return branches;
}

function mindMapSvg(model) {
  const W = 1200;
  const HEADER = 110;
  const FOOTER = 70;
  const BRANCH_GAP = 24;
  const LEAF_GAP = 8;

  const branches = mindMapBranches(model).map(branch => {
    const leaves = branch.items.map(item => {
      const lines = wrapText(item, 62, 2);
      return { lines, height: lines.length * 19 + 18 };
    });

    const height = Math.max(
      leaves.reduce((sum, leaf) => sum + leaf.height, 0) +
        LEAF_GAP * (leaves.length - 1),
      46
    );

    return { ...branch, leaves, height };
  });

  const bodyHeight = branches.reduce((sum, branch) => sum + branch.height, 0) +
    BRANCH_GAP * (branches.length - 1);

  const H = HEADER + bodyHeight + FOOTER;

  const rootW = 250;
  const rootH = 140;
  const rootX = 40;
  const rootCy = HEADER + bodyHeight / 2;
  const rootY = rootCy - rootH / 2;

  const labelX = 340;
  const labelW = 200;
  const leafX = 600;
  const leafW = 560;

  const rootLines = wrapText(model.title, 20, 3);
  const rootTextTop = rootCy - (rootLines.length * 22) / 2 - 4;

  const parts = [];

  let y = HEADER;

  branches.forEach(branch => {
    const cy = y + branch.height / 2;
    const color = branch.color;

    parts.push(`
      <path d="M${rootX + rootW} ${rootCy} C ${rootX + rootW + 45} ${rootCy}, ${labelX - 45} ${cy}, ${labelX} ${cy}"
        fill="none" stroke="${color}" stroke-width="2.5" stroke-opacity=".75"/>
      <rect x="${labelX}" y="${cy - 23}" width="${labelW}" height="46" rx="23"
        fill="${color}" fill-opacity=".14" stroke="${color}" stroke-width="1.5"/>
      <text x="${labelX + labelW / 2}" y="${cy + 5}" text-anchor="middle"
        font-family="${MAP_FONT}" font-size="14" font-weight="700" fill="${color}">${escapeHtml(branch.label)}</text>
    `);

    let leafY = y;

    branch.leaves.forEach((leaf, index) => {
      const leafCy = leafY + leaf.height / 2;

      parts.push(`
        <path d="M${labelX + labelW} ${cy} C ${labelX + labelW + 30} ${cy}, ${leafX - 30} ${leafCy}, ${leafX} ${leafCy}"
          fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity=".55"/>
        <rect x="${leafX}" y="${leafY}" width="${leafW}" height="${leaf.height}" rx="10"
          fill="#11172c" stroke="#252d4b"/>
        <rect x="${leafX}" y="${leafY + 8}" width="4" height="${leaf.height - 16}" rx="2" fill="${color}"/>
        ${leaf.lines.map((line, lineIndex) => `
          <text x="${leafX + 20}" y="${leafY + 23 + lineIndex * 19}"
            font-family="${MAP_BODY_FONT}" font-size="14" fill="#dfe5ff">${escapeHtml(line)}</text>
        `).join("")}
      `);

      leafY += leaf.height + LEAF_GAP;
    });

    y += branch.height + BRANCH_GAP;
  });

  const dateLabel = new Intl.DateTimeFormat("pt-BR").format(model.generatedAt);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mapa mental: ${escapeAttribute(model.title)}">
  <defs>
    <linearGradient id="nn-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#080b18"/>
      <stop offset="1" stop-color="#0d1330"/>
    </linearGradient>
    <linearGradient id="nn-root" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#32d6ff"/>
      <stop offset="1" stop-color="#7c6cff"/>
    </linearGradient>
    <radialGradient id="nn-glow-a">
      <stop offset="0" stop-color="#7c6cff" stop-opacity=".28"/>
      <stop offset="1" stop-color="#7c6cff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="nn-glow-b">
      <stop offset="0" stop-color="#32d6ff" stop-opacity=".2"/>
      <stop offset="1" stop-color="#32d6ff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#nn-bg)"/>
  <circle cx="140" cy="120" r="340" fill="url(#nn-glow-a)"/>
  <circle cx="${W - 120}" cy="${H - 100}" r="320" fill="url(#nn-glow-b)"/>

  <rect x="40" y="28" width="48" height="48" rx="14" fill="#7c6cff" fill-opacity=".17" stroke="#32d6ff" stroke-width="1.5"/>
  <text x="64" y="61" text-anchor="middle" font-family="${MAP_FONT}" font-size="24" font-weight="700" fill="#f5f7ff">N</text>
  <text x="104" y="48" font-family="${MAP_FONT}" font-size="17" font-weight="700" letter-spacing="2" fill="#f5f7ff">NEXUSNOTE</text>
  <text x="104" y="66" font-family="${MAP_BODY_FONT}" font-size="11" fill="#8e98b8">Conhecimento conectado</text>
  <text x="${W - 40}" y="48" text-anchor="end" font-family="${MAP_FONT}" font-size="15" font-weight="700" fill="#32d6ff">Mapa mental</text>
  <text x="${W - 40}" y="66" text-anchor="end" font-family="${MAP_BODY_FONT}" font-size="11" fill="#8e98b8">${escapeHtml(dateLabel)}</text>
  <line x1="40" y1="94" x2="${W - 40}" y2="94" stroke="#252d4b"/>

  <rect x="${rootX}" y="${rootY}" width="${rootW}" height="${rootH}" rx="30" fill="url(#nn-root)"/>
  ${rootLines.map((line, index) => `
    <text x="${rootX + rootW / 2}" y="${rootTextTop + 20 + index * 22}" text-anchor="middle"
      font-family="${MAP_FONT}" font-size="18" font-weight="700" fill="#050711">${escapeHtml(line)}</text>
  `).join("")}
  <text x="${rootX + rootW / 2}" y="${rootTextTop + 20 + rootLines.length * 22 + 6}" text-anchor="middle"
    font-family="${MAP_BODY_FONT}" font-size="12" font-weight="600" fill="#050711" fill-opacity=".75">${escapeHtml(shorten(model.subject, 30))}</text>

  ${parts.join("")}

  <line x1="40" y1="${H - 52}" x2="${W - 40}" y2="${H - 52}" stroke="#252d4b"/>
  <text x="40" y="${H - 26}" font-family="${MAP_FONT}" font-size="11" font-weight="700" letter-spacing="1.5" fill="#8e98b8">NEXUSNOTE · CONHECIMENTO CONECTADO</text>
  ${
    model.student
      ? `<text x="${W - 40}" y="${H - 26}" text-anchor="end" font-family="${MAP_BODY_FONT}" font-size="12" fill="#8e98b8">${escapeHtml(model.student)}</text>`
      : ""
  }
</svg>`;

  return { svg, width: W, height: H };
}

/* ---------- Ações da seção de síntese ---------- */

function generateReport() {
  if (!state.notebook) return;

  const model = buildStudyModel();

  $("#student-summary").innerHTML = summaryMarkup(model);
  $("#mind-map").innerHTML = mindMapSvg(model).svg;

  showToast("Resumo e mapa mental gerados.");
}

function fileSlug() {
  return String(state.notebook?.title || "caderno")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "caderno";
}

function downloadMindMap() {
  if (!state.notebook) return;

  const { svg } = mindMapSvg(buildStudyModel());

  downloadBlob(
    new Blob(
      [`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`],
      { type: "image/svg+xml;charset=utf-8" }
    ),
    `nexusnote-mapa-${fileSlug()}.svg`
  );
}

function downloadMindMapPng() {
  if (!state.notebook) return;

  const { svg, width, height } = mindMapSvg(buildStudyModel());
  const url = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
  );

  const image = new Image();

  image.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");

    canvas.width = width * scale;
    canvas.height = height * scale;

    const context = canvas.getContext("2d");
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);

    URL.revokeObjectURL(url);

    canvas.toBlob(blob => {
      if (blob) {
        downloadBlob(blob, `nexusnote-mapa-${fileSlug()}.png`);
      } else {
        showToast("Não foi possível gerar o PNG.");
      }
    }, "image/png");
  };

  image.onerror = () => {
    URL.revokeObjectURL(url);
    showToast("Não foi possível gerar o PNG.");
  };

  image.src = url;
}

function buildReportHtml(model) {
  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long"
  }).format(model.generatedAt);

  const meta = [
    ["Estudante", model.student || "Não informado"],
    ["Componente", model.subject || "—"],
    ["Turma", model.className || "—"],
    ["Emitido em", dateLabel]
  ];

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Relatório NexusNote · ${escapeHtml(model.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #18203b;
      background: #fff;
      font: 400 12.5px/1.65 Manrope, Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .cover {
      padding: 24px 28px;
      color: #f5f7ff;
      background: linear-gradient(135deg, #080b18 0%, #181d4a 100%);
      border-radius: 16px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .mark {
      display: grid; width: 44px; height: 44px; place-items: center;
      color: #f5f7ff; background: #7c6cff44; border: 1.5px solid #32d6ff;
      border-radius: 13px; font: 700 22px "Space Grotesk", Arial, sans-serif;
    }
    .brand strong { display: block; font: 700 15px "Space Grotesk", Arial, sans-serif; letter-spacing: .14em; }
    .brand small { color: #aab3d1; font-size: 10px; }
    .cover h1 { margin: 22px 0 4px; font: 700 26px/1.15 "Space Grotesk", Arial, sans-serif; }
    .cover p { color: #c4cbe1; }
    .accent { width: 64px; height: 4px; margin-top: 16px; background: linear-gradient(90deg, #32d6ff, #7c6cff); border-radius: 4px; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0 6px; }
    .meta div { padding: 9px 11px; background: #f3f2ff; border-radius: 10px; }
    .meta dt { color: #6b63c9; font: 700 9.5px "Space Grotesk", Arial, sans-serif; }
    .meta dd { margin: 2px 0 0; font-weight: 700; }
    .ns-block { margin-top: 18px; break-inside: avoid; }
    .ns-block h4 {
      margin: 0 0 7px; padding-left: 9px; color: #4338b8;
      border-left: 3px solid #32d6ff; font: 700 13.5px "Space Grotesk", Arial, sans-serif;
    }
    .ns-block h5 { margin: 10px 0 3px; color: #18203b; font: 700 12.5px "Space Grotesk", Arial, sans-serif; }
    .ns-block p { margin: 0 0 6px; }
    .ns-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0; list-style: none; }
    .ns-chips li { padding: 2px 11px; color: #4338b8; background: #eceaff; border-radius: 99px; font-weight: 600; }
    .ns-list, .ns-points { margin: 0; padding-left: 20px; }
    .ns-points li::marker { color: #7c6cff; font-weight: 700; }
    .ns-synthesis article { padding: 10px 14px; margin-bottom: 8px; background: #f7f8fd; border: 1px solid #e3e6f3; border-radius: 10px; }
    .ns-empty { color: #8087a8; font-style: italic; }
    .ns-stats { display: flex; gap: 12px; }
    .ns-stats div { flex: 1; padding: 10px 14px; background: #f3f2ff; border-radius: 10px; }
    .ns-stats strong { display: block; color: #4338b8; font: 700 22px "Space Grotesk", Arial, sans-serif; }
    .ns-stats span { color: #5c6486; font-size: 11px; }
    .ns-progress { height: 8px; margin-top: 10px; overflow: hidden; background: #e3e6f3; border-radius: 8px; }
    .ns-progress span { display: block; height: 100%; background: linear-gradient(90deg, #32d6ff, #7c6cff); }
    .map { margin-top: 22px; break-before: page; }
    .map h4 { margin: 0 0 10px; padding-left: 9px; color: #4338b8; border-left: 3px solid #32d6ff; font: 700 13.5px "Space Grotesk", Arial, sans-serif; }
    .map svg { display: block; width: 100%; height: auto; border-radius: 14px; }
    .footer {
      display: flex; justify-content: space-between; gap: 12px; margin-top: 22px; padding-top: 8px;
      color: #8087a8; border-top: 1px solid #e3e6f3; font: 700 9.5px "Space Grotesk", Arial, sans-serif; letter-spacing: .08em;
    }
  </style>
</head>
<body>
  <header class="cover">
    <div class="brand">
      <span class="mark">N</span>
      <span><strong>NEXUSNOTE</strong><small>Conhecimento conectado</small></span>
    </div>
    <h1>${escapeHtml(model.title)}</h1>
    <p>Relatório de aprendizagem</p>
    <div class="accent"></div>
  </header>

  <dl class="meta">
    ${meta.map(([label, value]) => `
      <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>
    `).join("")}
  </dl>

  ${summaryMarkup(model, { header: false })}

  <section class="map">
    <h4>Mapa mental</h4>
    ${mindMapSvg(model).svg}
  </section>

  <footer class="footer">
    <span>NEXUSNOTE · CONHECIMENTO CONECTADO</span>
    <span>${escapeHtml(dateLabel)}</span>
  </footer>
</body>
</html>`;
}

function downloadReport() {
  if (!state.notebook) return;

  const windowReport = window.open("", "_blank");

  if (!windowReport) {
    showToast("Permita janelas pop-up para gerar o PDF.");
    return;
  }

  windowReport.document.write(buildReportHtml(buildStudyModel()));
  windowReport.document.close();
  windowReport.focus();

  window.setTimeout(() => windowReport.print(), 900);
}

function shareWhatsApp() {
  if (!state.notebook) return;

  const message = encodeURIComponent(buildSummary().slice(0, 3500));
  window.open(`https://wa.me/?text=${message}`, "_blank", "noopener");
}

/* ==========================================================================
   Utilitários gerais
   ========================================================================== */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatText(value) {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(paragraph => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function formatDate(value) {
  if (!value) return "";

  return new Intl.DateTimeFormat("pt-BR").format(
    new Date(`${value}T12:00:00`)
  );
}

function formatDateTime(value) {
  if (!value) return "";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDuration(seconds) {
  const total = Math.round(Number(seconds) || 0);

  if (total < 60) return `${total} s`;

  const minutes = Math.floor(total / 60);
  const rest = total % 60;

  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

function shorten(value, max) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;

  toast.textContent = message;
  toast.hidden = false;

  clearTimeout(state.toastTimer);

  state.toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3500);
}

/* ==========================================================================
   Perfil
   ========================================================================== */

function bindProfile() {
  $("#profile-form")?.addEventListener("submit", saveProfile);
  $("#profile-avatar")?.addEventListener("change", previewAvatar);
}

function renderProfile() {
  if (!state.profile) return;

  input("#profile-full-name", state.profile.full_name || "");
  text(
    "#profile-avatar-placeholder",
    (state.profile.full_name || "N").charAt(0).toUpperCase()
  );

  if (state.profile.avatar_url) {
    const image = $("#profile-avatar-preview");
    image.src = state.profile.avatar_url;
    image.hidden = false;
    $("#profile-avatar-placeholder").hidden = true;
  }
}

function previewAvatar(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    text("#profile-status", "Use uma imagem PNG, JPG ou WebP.");
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    text("#profile-status", "A imagem deve ter até 2 MB.");
    return;
  }

  const image = $("#profile-avatar-preview");
  image.src = URL.createObjectURL(file);
  image.hidden = false;
  $("#profile-avatar-placeholder").hidden = true;
}

async function saveProfile(event) {
  event.preventDefault();

  const name = getValue("#profile-full-name");
  const file = $("#profile-avatar")?.files?.[0];

  if (!name) {
    text("#profile-status", "Informe o nome.");
    return;
  }

  text("#profile-status", "Salvando perfil...");

  let avatarUrl = state.profile.avatar_url || null;

  if (file) {
    const extension = file.type === "image/png"
      ? "png"
      : file.type === "image/webp"
        ? "webp"
        : "jpg";

    const path = `${state.user.id}/avatar.${extension}`;

    const upload = await window.supabaseClient.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, {
        upsert: true,
        contentType: file.type
      });

    if (upload.error) {
      text("#profile-status", "Não foi possível enviar a imagem.");
      return;
    }

    avatarUrl = window.supabaseClient.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(path)
      .data.publicUrl + `?v=${Date.now()}`;
  }

  const response = await window.supabaseClient
    .from(PROFILE_TABLE)
    .update({
      full_name: name,
      avatar_url: avatarUrl
    })
    .eq("id", state.user.id)
    .select("*")
    .single();

  if (response.error) {
    console.error(response.error);
    text("#profile-status", "Não foi possível salvar o perfil.");
    return;
  }

  state.profile = response.data;
  text("#session-label", name);
  text("#student-profile-name", name);
  renderProfile();
  text("#profile-status", "Perfil atualizado com sucesso.");
}

/* ==========================================================================
   Área do professor · construtor de cadernos
   ========================================================================== */

function bindTeacher() {
  /* Um único botão: cria o texto e, logo abaixo, o box de resumo do estudante. */
  $("#add-teacher-text")?.addEventListener("click", () => {
    state.builderBlocks.push(...createTextWithSummary());
    renderBuilders();
  });

  $("#add-question-button")?.addEventListener("click", () => {
    state.builderBlocks.push({
      id: crypto.randomUUID(),
      type: "question",
      statement: "",
      command: "",
      options: [
        { letter: "A", text: "", correct: false },
        { letter: "B", text: "", correct: false }
      ]
    });

    renderBuilders();
  });

  ["#teacher-text-list", "#question-builder-list"].forEach(selector => {
    const list = $(selector);

    list?.addEventListener("input", handleBuilderInput);
    list?.addEventListener("click", handleBuilderClick);
    list?.addEventListener("change", handleBuilderChange);
  });

  $("#notebook-form")?.addEventListener("submit", saveNotebook);
  $("#cancel-edit")?.addEventListener("click", resetNotebookForm);
  $("#refresh-notebooks")?.addEventListener("click", loadTeacherEnvironment);
  $("#analysis-notebook")?.addEventListener("change", loadAnalysis);
  $("#export-analysis")?.addEventListener("click", exportAnalysis);

  document.addEventListener("click", event => {
    const edit = event.target.closest("[data-edit-notebook]");
    const remove = event.target.closest("[data-delete-notebook]");

    if (edit) editNotebook(edit.dataset.editNotebook);
    if (remove) deleteNotebook(remove.dataset.deleteNotebook);
  });
}

function renderBuilders() {
  const textTarget = $("#teacher-text-list");
  const questionsTarget = $("#question-builder-list");

  if (!textTarget || !questionsTarget) return;

  const blocks = state.builderBlocks;
  const usedSummaries = new Set();

  let textHtml = "";
  let questionHtml = "";
  let textNumber = 0;

  blocks.forEach((block, index) => {
    if (block.type !== "teacher_text") return;

    textNumber++;

    const summaryIndex = blocks.findIndex(
      item => item.type === "student_summary" && item.linked_to === block.id
    );

    if (summaryIndex >= 0) usedSummaries.add(summaryIndex);

    textHtml += renderTextPairBuilder(block, index, textNumber, summaryIndex);
  });

  blocks.forEach((block, index) => {
    if (block.type === "student_summary" && !usedSummaries.has(index)) {
      textHtml += renderStandaloneSummaryBuilder(block, index);
    }

    if (block.type === "question") {
      questionHtml += renderQuestionBuilder(block, index);
    }
  });

  textTarget.innerHTML = textHtml ||
    `<div class="empty-state">Nenhum texto adicionado. Ao adicionar um texto, o box de resumo do estudante é criado automaticamente abaixo dele.</div>`;

  questionsTarget.innerHTML = questionHtml ||
    `<div class="empty-state">Nenhuma questão adicionada.</div>`;
}

function summarySettingsHtml(summary, summaryIndex) {
  return `
    <details class="summary-settings">
      <summary>Personalizar título e orientação</summary>

      <label>
        Título do box
        <input value="${escapeAttribute(summary.title)}" data-block="${summaryIndex}" data-field="title">
      </label>

      <label>
        Texto de orientação
        <input value="${escapeAttribute(summary.placeholder)}" data-block="${summaryIndex}" data-field="placeholder">
      </label>
    </details>
  `;
}

function renderTextPairBuilder(block, index, number, summaryIndex) {
  const summary = state.builderBlocks[summaryIndex];

  return `
    <article class="builder-card text-pair">
      <div class="builder-card-top">
        <strong>Texto ${number}</strong>
        <button type="button" class="remove-button" data-remove-block="${index}">Remover</button>
      </div>

      <textarea rows="6" data-block="${index}" data-field="text"
        placeholder="Digite o texto do professor...">${escapeHtml(block.text)}</textarea>

      <label class="image-input">
        Inserir imagem
        <input type="file" accept="image/png,image/jpeg,image/webp"
          data-image-block="${index}">
      </label>

      ${
        block.image_url
          ? `<img class="builder-image-preview" src="${escapeAttribute(block.image_url)}" alt="Imagem do bloco">`
          : ""
      }

      ${
        summary
          ? `
            <div class="summary-slot">
              <div class="summary-slot-head">
                <strong>Box de resumo do estudante</strong>
                <small>Criado automaticamente abaixo deste texto</small>
              </div>

              <textarea rows="3" disabled
                placeholder="${escapeAttribute(summary.placeholder)}"></textarea>

              ${summarySettingsHtml(summary, summaryIndex)}
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderStandaloneSummaryBuilder(block, index) {
  return `
    <article class="builder-card text-pair">
      <div class="builder-card-top">
        <strong>Box de resumo do estudante</strong>
        <button type="button" class="remove-button" data-remove-block="${index}">Remover</button>
      </div>

      <div class="summary-slot">
        <textarea rows="3" disabled
          placeholder="${escapeAttribute(block.placeholder)}"></textarea>

        ${summarySettingsHtml(block, index)}
      </div>
    </article>
  `;
}

function renderQuestionBuilder(question, index) {
  return `
    <article class="builder-card">
      <div class="builder-card-top">
        <strong>Questão ${index + 1}</strong>
        <button type="button" class="remove-button" data-remove-block="${index}">Remover</button>
      </div>

      <label>
        Texto da questão
        <textarea rows="4" data-block="${index}" data-field="statement"
          placeholder="Digite o texto da questão...">${escapeHtml(question.statement)}</textarea>
      </label>

      <label>
        Orientação
        <input value="${escapeAttribute(question.command)}"
          data-block="${index}" data-field="command"
          placeholder="Ex.: Escolha a alternativa correta.">
      </label>

      <div class="alternatives-heading">
        <strong>Alternativas</strong>
        <button type="button" class="outline-button small-button" data-add-option="${index}">
          Adicionar alternativa
        </button>
      </div>

      <div class="option-list">
        ${question.options.map((option, optionIndex) => `
          <div class="option-row">
            <input type="radio"
              name="correct-${index}"
              data-correct-block="${index}"
              data-correct-option="${optionIndex}"
              ${option.correct ? "checked" : ""}
              title="Marcar como gabarito">

            <b>${escapeHtml(option.letter)}</b>

            <input type="text"
              value="${escapeAttribute(option.text)}"
              data-option-block="${index}"
              data-option-index="${optionIndex}"
              placeholder="Texto da alternativa">

            ${
              optionIndex > 1
                ? `<button type="button" class="remove-button"
                    data-remove-option="${index}"
                    data-option-index="${optionIndex}">×</button>`
                : "<span></span>"
            }
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function handleBuilderInput(event) {
  const element = event.target;
  const block = state.builderBlocks[Number(element.dataset.block)];

  if (block && element.dataset.field) {
    block[element.dataset.field] = element.value;
  }

  if (element.dataset.optionBlock !== undefined) {
    const question = state.builderBlocks[Number(element.dataset.optionBlock)];
    const option = question?.options[Number(element.dataset.optionIndex)];

    if (option) option.text = element.value;
  }
}

function handleBuilderChange(event) {
  const element = event.target;

  if (element.dataset.imageBlock !== undefined) {
    uploadBlockImage(Number(element.dataset.imageBlock), element.files?.[0]);
  }

  if (element.dataset.correctBlock !== undefined) {
    const question = state.builderBlocks[Number(element.dataset.correctBlock)];
    const optionIndex = Number(element.dataset.correctOption);

    question.options.forEach(option => {
      option.correct = false;
    });

    question.options[optionIndex].correct = true;
  }
}

async function uploadBlockImage(index, file) {
  if (!file) return;

  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    showToast("Use uma imagem PNG, JPG ou WebP.");
    return;
  }

  if (file.size > 4 * 1024 * 1024) {
    showToast("A imagem deve ter até 4 MB.");
    return;
  }

  const extension = file.type === "image/png"
    ? "png"
    : file.type === "image/webp"
      ? "webp"
      : "jpg";

  const path = `${state.user.id}/${crypto.randomUUID()}.${extension}`;

  const response = await window.supabaseClient.storage
    .from(NOTEBOOK_IMAGE_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false
    });

  if (response.error) {
    console.error(response.error);
    showToast("Não foi possível enviar a imagem.");
    return;
  }

  state.builderBlocks[index].image_url =
    window.supabaseClient.storage
      .from(NOTEBOOK_IMAGE_BUCKET)
      .getPublicUrl(path)
      .data.publicUrl;

  renderBuilders();
}

function handleBuilderClick(event) {
  const removeBlock = event.target.closest("[data-remove-block]");
  const addOption = event.target.closest("[data-add-option]");
  const removeOption = event.target.closest("[data-remove-option]");

  if (removeBlock) {
    const index = Number(removeBlock.dataset.removeBlock);
    const removed = state.builderBlocks[index];

    /* Remover um texto também remove o box de resumo ligado a ele. */
    state.builderBlocks = state.builderBlocks.filter((block, position) => {
      if (position === index) return false;

      return !(
        removed?.type === "teacher_text" &&
        block.type === "student_summary" &&
        block.linked_to === removed.id
      );
    });

    renderBuilders();
  }

  if (addOption) {
    const question = state.builderBlocks[Number(addOption.dataset.addOption)];

    if (question.options.length >= 5) {
      showToast("Cada questão pode ter no máximo cinco alternativas.");
      return;
    }

    question.options.push({
      letter: String.fromCharCode(65 + question.options.length),
      text: "",
      correct: false
    });

    renderBuilders();
  }

  if (removeOption) {
    const question = state.builderBlocks[Number(removeOption.dataset.removeOption)];
    const optionIndex = Number(removeOption.dataset.optionIndex);

    question.options.splice(optionIndex, 1);
    renumberOptions(question);
    renderBuilders();
  }
}

function renumberOptions(question) {
  question.options.forEach((option, index) => {
    option.letter = String.fromCharCode(65 + index);
  });
}

async function loadTeacherEnvironment() {
  if (!state.user) return;

  const response = await window.supabaseClient
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (response.error) {
    console.error(response.error);
    showToast("Não foi possível carregar os cadernos.");
    return;
  }

  state.notebooks = response.data || [];
  renderTeacherLibrary();
  renderTeacherMetrics();
  fillAnalysisSelect();
  renderBuilders();
}

function canEdit(notebook) {
  const role = String(state.profile?.role || "").toLowerCase();

  return (
    ["admin", "administrator"].includes(role) ||
    String(notebook.created_by) === String(state.user.id)
  );
}

function renderTeacherMetrics() {
  text("#metric-notebooks", state.notebooks.length);
  text("#metric-editable", state.notebooks.filter(canEdit).length);

  const ids = state.notebooks.map(notebook => notebook.id);

  if (!ids.length) {
    text("#metric-submissions", "0");
    return;
  }

  window.supabaseClient
    .from(SUBMISSIONS_TABLE)
    .select("id", { count: "exact", head: true })
    .in("notebook_id", ids)
    .then(response => {
      text("#metric-submissions", response.count || 0);
    });
}

function renderTeacherLibrary() {
  const target = $("#teacher-notebooks");

  target.innerHTML = state.notebooks.length
    ? state.notebooks.map(notebook => `
        <article class="teacher-notebook">
          <div>
            <span class="eyebrow">${escapeHtml(SUBJECT_NAMES[notebook.subject_id] || "")}</span>
            <h3>${escapeHtml(notebook.title)}</h3>
            <p>${escapeHtml(notebook.description || "")}</p>
            <small>${notebook.published ? "Publicado" : "Rascunho"}</small>
          </div>

          <div class="teacher-actions">
            ${
              canEdit(notebook)
                ? `<button class="outline-button" type="button" data-edit-notebook="${escapeAttribute(notebook.id)}">Editar</button>`
                : ""
            }

            ${
              String(notebook.created_by) === String(state.user.id)
                ? `<button class="remove-button" type="button" data-delete-notebook="${escapeAttribute(notebook.id)}">Excluir</button>`
                : ""
            }
          </div>
        </article>
      `).join("")
    : `<div class="empty-state">Nenhum caderno encontrado.</div>`;
}

async function saveNotebook(event) {
  event.preventDefault();

  const id = getValue("#notebook-id");
  const existing = state.notebooks.find(item => String(item.id) === String(id));

  if (id && (!existing || !canEdit(existing))) {
    text("#notebook-status", "Você não possui permissão para editar este caderno.");
    return;
  }

  const subject = getValue("#notebook-subject");
  const title = getValue("#notebook-title");
  const className = getValue("#notebook-class");
  const description = getValue("#notebook-description");

  if (!subject || !title || !className || !description) {
    text("#notebook-status", "Preencha componente, turma, título e descrição.");
    return;
  }

  const blocks = state.builderBlocks;

  if (blocks.some(block => block.type === "teacher_text" && !block.text.trim())) {
    text("#notebook-status", "Preencha o texto de todos os blocos de texto ou remova os vazios.");
    return;
  }

  const questions = blocks.filter(block => block.type === "question");

  for (const question of questions) {
    if (!question.statement.trim()) {
      text("#notebook-status", "Preencha o texto de todas as questões.");
      return;
    }

    if (question.options.length < 2) {
      text("#notebook-status", "Cada questão precisa de pelo menos duas alternativas.");
      return;
    }

    if (!question.options.some(option => option.correct)) {
      text("#notebook-status", "Selecione um gabarito para cada questão.");
      return;
    }

    if (question.options.some(option => !option.text.trim())) {
      text("#notebook-status", "Preencha todas as alternativas.");
      return;
    }
  }

  const payload = {
    subject_id: subject,
    subject_name: SUBJECT_NAMES[subject],
    class_name: className,
    title,
    deadline: getValue("#notebook-deadline") || null,
    description,
    learning_objective: getValue("#notebook-objective"),
    competencies: getValue("#notebook-competencies"),
    keywords: getValue("#notebook-keywords"),
    student_instructions: getValue("#notebook-instructions"),
    activity_blocks: blocks,
    content: blocks
      .filter(block => block.type === "teacher_text")
      .map(block => block.text)
      .join("\n\n"),
    questions_config: questions,
    public_questions: questions,
    published: $("#notebook-published").checked
  };

  text("#notebook-status", "Salvando caderno...");

  const response = id
    ? await window.supabaseClient.from(TABLE).update(payload).eq("id", id)
    : await window.supabaseClient.from(TABLE).insert({
        ...payload,
        created_by: state.user.id
      });

  if (response.error) {
    console.error(response.error);
    text("#notebook-status", "Não foi possível salvar o caderno.");
    return;
  }

  resetNotebookForm();
  text("#notebook-status", "Caderno salvo com sucesso.");
  await loadTeacherEnvironment();
}

function editNotebook(id) {
  const notebook = state.notebooks.find(item => String(item.id) === String(id));

  if (!notebook || !canEdit(notebook)) {
    showToast("Você não possui permissão para editar este caderno.");
    return;
  }

  input("#notebook-id", notebook.id);
  input("#notebook-subject", notebook.subject_id);
  input("#notebook-class", notebook.class_name);
  input("#notebook-title", notebook.title);
  input("#notebook-deadline", notebook.deadline);
  input("#notebook-description", notebook.description);
  input("#notebook-objective", notebook.learning_objective);
  input("#notebook-competencies", notebook.competencies);
  input("#notebook-keywords", notebook.keywords);
  input("#notebook-instructions", notebook.student_instructions);

  $("#notebook-published").checked = Boolean(notebook.published);

  let blocks = normalizeBlocks(notebook.activity_blocks);

  if (!blocks.length && notebook.content) {
    blocks = createTextWithSummary(notebook.content);
  }

  state.builderBlocks = ensureSummaryBlocks(blocks);

  $("#cancel-edit").hidden = false;
  renderBuilders();

  $("#notebook-form").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

async function deleteNotebook(id) {
  const notebook = state.notebooks.find(item => String(item.id) === String(id));

  if (!notebook || String(notebook.created_by) !== String(state.user.id)) {
    return;
  }

  if (!window.confirm("Deseja excluir este caderno?")) return;

  const response = await window.supabaseClient
    .from(TABLE)
    .delete()
    .eq("id", id);

  if (response.error) {
    showToast("Não foi possível excluir o caderno.");
    return;
  }

  await loadTeacherEnvironment();
}

function resetNotebookForm() {
  $("#notebook-form")?.reset();
  input("#notebook-id", "");
  state.builderBlocks = [];
  $("#cancel-edit").hidden = true;
  text("#notebook-status", "");
  renderBuilders();
}

/* ==========================================================================
   Análise pedagógica
   ========================================================================== */

const BANDS = [
  {
    id: "pleno",
    label: "Domínio pleno",
    range: `${ANALYSIS.masteryMin}% a 100%`,
    color: "#61e4b2"
  },
  {
    id: "consolidacao",
    label: "Em consolidação",
    range: `${ANALYSIS.consolidationMin}% a ${ANALYSIS.masteryMin - 1}%`,
    color: "#ffd166"
  },
  {
    id: "atencao",
    label: "Atenção / defasagem",
    range: `Menos de ${ANALYSIS.consolidationMin}%`,
    color: "#ff8d9b"
  }
];

const NO_BAND = { id: "none", label: "Sem questões", range: "", color: "#8e98b8" };

const CATEGORIES = {
  consistente: {
    id: "consistente",
    label: "Consistente",
    rule: "Texto elaborado + alto acerto",
    hint: "Comprende o conceito e consegue verbalizá-lo.",
    color: "#61e4b2"
  },
  ilusao: {
    id: "ilusao",
    label: "Ilusão de compreensão",
    rule: "Texto longo e confiante + baixo acerto",
    hint: "Escreve com segurança, mas entendeu o conceito de forma equivocada.",
    color: "#ffd166"
  },
  intuitivo: {
    id: "intuitivo",
    label: "Intuitivo / pragmático",
    rule: "Texto raso + alto acerto",
    hint: "Resolve o teste, mas não verbaliza o processo.",
    color: "#32d6ff"
  },
  dificuldade: {
    id: "dificuldade",
    label: "Dificuldade ampla",
    rule: "Texto raso + baixo acerto",
    hint: "Precisa retomar o conteúdo com acompanhamento.",
    color: "#ff8d9b"
  },
  semdados: {
    id: "semdados",
    label: "Sem questões",
    rule: "Não há acertos para cruzar com o texto",
    hint: "",
    color: "#8e98b8"
  }
};

function accuracyBand(pct) {
  if (pct === null || pct === undefined) return NO_BAND;
  if (pct >= ANALYSIS.masteryMin) return BANDS[0];
  if (pct >= ANALYSIS.consolidationMin) return BANDS[1];
  return BANDS[2];
}

function accuracyPct(item) {
  const total = Number(item.total_questions || 0);

  if (!total || item.score === null || item.score === undefined) return null;

  return Math.round(Number(item.score) / total * 100);
}

function isRichText(stats) {
  return (
    stats.words >= ANALYSIS.richTextMinWords &&
    stats.sentences >= ANALYSIS.richTextMinSentences
  );
}

function learnerCategory(accuracy, stats) {
  if (accuracy === null) return CATEGORIES.semdados;

  const rich = isRichText(stats);
  const high = accuracy >= ANALYSIS.highAccuracyMin;

  if (rich && high) return CATEGORIES.consistente;
  if (rich && !high) return CATEGORIES.ilusao;
  if (!rich && high) return CATEGORIES.intuitivo;
  return CATEGORIES.dificuldade;
}

function parseMetrics(value) {
  if (!value) return null;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  return typeof value === "object" ? value : null;
}

function enrichSubmission(item) {
  const metrics = parseMetrics(item.metrics);
  const accuracy = accuracyPct(item);
  const stats = metrics?.text || textStats(item.notes || "");

  return {
    item,
    name: item.student_name || item.student_code || "Estudante",
    metrics,
    accuracy,
    band: accuracyBand(accuracy),
    text: stats,
    editing: metrics?.editing || null,
    seconds: metrics?.stage_seconds || null,
    category: learnerCategory(accuracy, stats)
  };
}

function average(values) {
  const list = values.filter(value => Number.isFinite(value));
  return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0;
}

function percent(part, whole) {
  return whole ? Math.round(part / whole * 100) : 0;
}

function fillAnalysisSelect() {
  const select = $("#analysis-notebook");
  const previous = select.value;

  select.innerHTML = state.notebooks.length
    ? state.notebooks.map(notebook => `
        <option value="${escapeAttribute(notebook.id)}">
          ${escapeHtml(notebook.title)}
        </option>
      `).join("")
    : `<option value="">Nenhum caderno</option>`;

  if (previous && state.notebooks.some(item => String(item.id) === previous)) {
    select.value = previous;
  }

  loadAnalysis();
}

async function loadAnalysis() {
  const id = $("#analysis-notebook").value;

  if (!id) {
    renderAnalysis([]);
    return;
  }

  const response = await window.supabaseClient
    .from(SUBMISSIONS_TABLE)
    .select("*")
    .eq("notebook_id", id)
    .order("submitted_at", { ascending: false });

  if (response.error) {
    console.error(response.error);
    renderAnalysis([]);
    return;
  }

  state.submissions = response.data || [];
  renderAnalysis(state.submissions);
}

function renderAnalysis(submissions) {
  const rows = submissions.map(enrichSubmission);
  state.analysisRows = rows;

  const total = rows.length;
  const average_ = Math.round(
    average(rows.map(row => Number(row.item.progress || 0)))
  );

  const completed = rows.filter(row => Number(row.item.progress || 0) >= 100).length;
  const advanced = rows.filter(row => Number(row.item.progress || 0) >= 75).length;
  const developing = rows.filter(row => {
    const progress = Number(row.item.progress || 0);
    return progress >= 40 && progress < 75;
  }).length;

  const initial = Math.max(total - advanced - developing, 0);

  const correct = rows.reduce((sum, row) => sum + Number(row.item.score || 0), 0);
  const totalQuestions = rows.reduce(
    (sum, row) => sum + Number(row.item.total_questions || 0),
    0
  );
  const incorrect = Math.max(totalQuestions - correct, 0);

  $("#analysis-metrics").innerHTML = `
    <article><strong>${total}</strong><span>Envios analisados</span></article>
    <article><strong>${average_}%</strong><span>Progresso médio</span></article>
    <article><strong>${completed}</strong><span>Percursos concluídos</span></article>
  `;

  const bandCounts = BANDS.map(
    band => rows.filter(row => row.band.id === band.id).length
  );

  const categoryList = [
    CATEGORIES.consistente,
    CATEGORIES.ilusao,
    CATEGORIES.intuitivo,
    CATEGORIES.dificuldade
  ];

  const categoryCounts = categoryList.map(
    category => rows.filter(row => row.category.id === category.id).length
  );

  drawPie("participation-chart", [total], ["Envios"], ["#32d6ff"], "participation-legend");
  drawPie("progress-chart", [advanced, developing, initial], ["Avançado", "Em desenvolvimento", "Inicial"], ["#61e4b2", "#ffd166", "#ff8d9b"], "progress-legend");
  drawPie("performance-chart", [correct, incorrect], ["Acertos", "Erros"], ["#7c6cff", "#ff8d9b"], "performance-legend");
  drawPie("completion-chart", [completed, Math.max(total - completed, 0)], ["Concluído", "Em andamento"], ["#61e4b2", "#32d6ff"], "completion-legend");
  drawPie("bands-chart", bandCounts, BANDS.map(band => band.label), BANDS.map(band => band.color), "bands-legend");
  drawPie("category-chart", categoryCounts, categoryList.map(category => category.label), categoryList.map(category => category.color), "category-legend");

  renderBandsAxis(rows);
  renderQuestionsAxis(rows);
  renderTimeAxis(rows);
  renderTextAxis(rows);
  renderEditingAxis(rows);
  renderCategoryAxis(rows);
  renderInsights(rows, { correct, incorrect, average: average_ });

  $("#submissions-table").innerHTML = rows.length
    ? rows.map(row => {
        const item = row.item;
        const seconds = row.seconds;
        const editing = row.editing;

        return `
          <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(formatDateTime(item.submitted_at))}</td>
            <td>${item.score ?? "Aguardando"}/${item.total_questions || 0}${row.accuracy === null ? "" : ` (${row.accuracy}%)`}</td>
            <td><span class="pill" style="--tone:${row.band.color}">${escapeHtml(row.band.label)}</span></td>
            <td><span class="pill" style="--tone:${row.category.color}">${escapeHtml(row.category.label)}</span></td>
            <td>${row.text.words} pal. · ${row.text.paragraphs} parág.</td>
            <td>${
              seconds
                ? `${formatDuration(seconds.leitura)} / ${formatDuration(seconds.sintese)} / ${formatDuration(seconds.questoes)}`
                : "—"
            }</td>
            <td>${
              editing
                ? (editing.paste_dominant
                    ? `<span class="pill" style="--tone:#ff8d9b">Colagem predominante</span>`
                    : `${editing.paste_events} colagem(ns) · ${editing.deletions} apag.`)
                : "—"
            }</td>
            <td>${Number(item.progress || 0)}%</td>
          </tr>
        `;
      }).join("")
    : `<tr><td colspan="9">Nenhum envio encontrado.</td></tr>`;
}

/* ---------- Eixo 1: faixas de acerto ---------- */

function renderBandsAxis(rows) {
  const scored = rows.filter(row => row.accuracy !== null);

  $("#analysis-bands").innerHTML = `
    <div class="band-grid">
      ${BANDS.map(band => {
        const count = scored.filter(row => row.band.id === band.id).length;

        return `
          <article class="band-tile" style="--tone:${band.color}">
            <span class="band-range">${escapeHtml(band.range)}</span>
            <strong>${count}</strong>
            <span>${escapeHtml(band.label)}</span>
            <small>${percent(count, scored.length)}% dos estudantes</small>
          </article>
        `;
      }).join("")}
    </div>
    <p class="axis-note">Calculado sobre o percentual de acertos de cada estudante (${scored.length} com questões respondidas).</p>
  `;
}

function renderQuestionsAxis(rows) {
  const target = $("#analysis-questions");
  const notebook = state.notebooks.find(
    item => String(item.id) === String($("#analysis-notebook").value)
  );

  const questions = normalizeBlocks(notebook?.activity_blocks)
    .filter(block => block.type === "question");

  const withAnswers = rows.filter(
    row => row.item.answers && typeof row.item.answers === "object"
  );

  if (!questions.length || !withAnswers.length) {
    target.innerHTML = `<div class="empty-state">Sem respostas por questão para este caderno.</div>`;
    return;
  }

  target.innerHTML = questions.map((question, index) => {
    const correctLetter = question.options.find(option => option.correct)?.letter;
    const wrong = {};
    let hits = 0;

    withAnswers.forEach(row => {
      const answer = row.item.answers[index] ?? row.item.answers[String(index)] ?? "";

      if (answer && answer === correctLetter) {
        hits++;
      } else if (answer) {
        wrong[answer] = (wrong[answer] || 0) + 1;
      }
    });

    const pct = percent(hits, withAnswers.length);
    const band = accuracyBand(pct);
    const topWrong = Object.entries(wrong).sort((a, b) => b[1] - a[1])[0];

    return `
      <article class="question-stat" style="--tone:${band.color}">
        <div class="question-stat-head">
          <strong>Questão ${index + 1}</strong>
          <span class="pill" style="--tone:${band.color}">${escapeHtml(band.label)}</span>
        </div>
        <p>${escapeHtml(shorten(question.statement, 110))}</p>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <small>${pct}% de acertos (${hits} de ${withAnswers.length})${
          topWrong
            ? ` · erro mais comum: alternativa ${escapeHtml(topWrong[0])} (${topWrong[1]})`
            : ""
        }</small>
      </article>
    `;
  }).join("");
}

/* ---------- Eixo 2: tempo por etapa ---------- */

function renderTimeAxis(rows) {
  const target = $("#analysis-time");
  const timed = rows.filter(row => row.seconds);

  if (!timed.length) {
    target.innerHTML = `<div class="empty-state">Sem dados de tempo. Eles aparecem nos envios feitos após esta atualização.</div>`;
    return;
  }

  const stages = [
    { key: "leitura", label: STAGES.leitura, color: "#32d6ff" },
    { key: "sintese", label: STAGES.sintese, color: "#7c6cff" },
    { key: "questoes", label: STAGES.questoes, color: "#ffd166" }
  ].map(stage => ({
    ...stage,
    value: average(timed.map(row => Number(row.seconds[stage.key] || 0)))
  }));

  const total = stages.reduce((sum, stage) => sum + stage.value, 0);

  if (!total) {
    target.innerHTML = `<div class="empty-state">Nenhum tempo ativo registrado nos envios.</div>`;
    return;
  }

  const reading = stages[0].value + stages[1].value;

  target.innerHTML = `
    <div class="stage-bar" role="img" aria-label="Tempo médio por etapa">
      ${stages.map(stage => `
        <span style="width:${percent(stage.value, total)}%;background:${stage.color}"></span>
      `).join("")}
    </div>

    <div class="stage-legend">
      ${stages.map(stage => `
        <div>
          <i style="background:${stage.color}"></i>
          <span>${escapeHtml(stage.label)}</span>
          <strong>${formatDuration(stage.value)}</strong>
          <small>${percent(stage.value, total)}%</small>
        </div>
      `).join("")}
    </div>

    <p class="axis-note">
      Leitura e síntese: ${formatDuration(reading)} (${percent(reading, total)}%).
      Questões objetivas: ${formatDuration(stages[2].value)} (${percent(stages[2].value, total)}%).
      Média de ${timed.length} envio(s); conta apenas o tempo com a aba ativa.
    </p>
  `;
}

/* ---------- Eixo 3: volume textual da síntese ---------- */

function renderTextAxis(rows) {
  const target = $("#analysis-text");

  if (!rows.length) {
    target.innerHTML = `<div class="empty-state">Sem envios para analisar.</div>`;
    return;
  }

  const rich = rows.filter(row => isRichText(row.text)).length;
  const empty = rows.filter(row => !row.text.words).length;

  target.innerHTML = `
    <div class="stat-cards">
      <article><strong>${Math.round(average(rows.map(row => row.text.words)))}</strong><span>palavras (média)</span></article>
      <article><strong>${Math.round(average(rows.map(row => row.text.chars)))}</strong><span>caracteres (média)</span></article>
      <article><strong>${average(rows.map(row => row.text.paragraphs)).toFixed(1)}</strong><span>parágrafos (média)</span></article>
      <article><strong>${average(rows.map(row => row.text.line_breaks)).toFixed(1)}</strong><span>quebras de linha (média)</span></article>
    </div>

    <p class="axis-note">
      ${rich} de ${rows.length} sínteses elaboradas (${ANALYSIS.richTextMinWords}+ palavras e ${ANALYSIS.richTextMinSentences}+ frases);
      ${rows.length - rich - empty} rasas; ${empty} sem texto.
    </p>
  `;
}

/* ---------- Eixo 4: comportamento de edição ---------- */

function renderEditingAxis(rows) {
  const target = $("#analysis-editing");
  const tracked = rows.filter(row => row.editing);

  if (!tracked.length) {
    target.innerHTML = `<div class="empty-state">Sem dados de edição. Eles aparecem nos envios feitos após esta atualização.</div>`;
    return;
  }

  const withPaste = tracked.filter(row => row.editing.paste_events > 0).length;
  const dominant = tracked.filter(row => row.editing.paste_dominant).length;

  target.innerHTML = `
    <div class="stat-cards">
      <article><strong>${percent(withPaste, tracked.length)}%</strong><span>usaram colar (${withPaste} de ${tracked.length})</span></article>
      <article><strong>${dominant}</strong><span>colagem predominante</span></article>
      <article><strong>${Math.round(average(tracked.map(row => row.editing.deletions)))}</strong><span>apagamentos (média)</span></article>
      <article><strong>${Math.round(average(tracked.map(row => row.editing.deletion_rate || 0)) * 100)}</strong><span>apagamentos por 100 caracteres digitados</span></article>
    </div>

    <p class="axis-note">
      Colagem predominante: pelo menos ${Math.round(ANALYSIS.pasteDominantRatio * 100)}% do texto final veio de colar.
      Muitos apagamentos indicam reescrita e refinamento.
    </p>
  `;
}

/* ---------- Eixo 5: categorias de aprendizagem ---------- */

function renderCategoryAxis(rows) {
  const target = $("#analysis-categories");

  const cell = category => {
    const members = rows.filter(row => row.category.id === category.id);
    const names = members.slice(0, 6).map(row => escapeHtml(row.name)).join(", ");
    const extra = members.length > 6 ? ` e mais ${members.length - 6}` : "";

    return `
      <article class="matrix-cell" style="--tone:${category.color}">
        <header>
          <strong>${escapeHtml(category.label)}</strong>
          <b>${members.length}</b>
        </header>
        <span>${escapeHtml(category.rule)}</span>
        <small>${escapeHtml(category.hint)}</small>
        <p>${members.length ? `${names}${extra}` : "Nenhum estudante"}</p>
      </article>
    `;
  };

  const noData = rows.filter(row => row.category.id === "semdados").length;

  target.innerHTML = `
    <div class="matrix">
      <span class="matrix-axis"></span>
      <span class="matrix-axis">Alto acerto (${ANALYSIS.highAccuracyMin}% ou mais)</span>
      <span class="matrix-axis">Baixo acerto</span>

      <span class="matrix-axis">Texto elaborado</span>
      ${cell(CATEGORIES.consistente)}
      ${cell(CATEGORIES.ilusao)}

      <span class="matrix-axis">Texto raso</span>
      ${cell(CATEGORIES.intuitivo)}
      ${cell(CATEGORIES.dificuldade)}
    </div>
    ${noData ? `<p class="axis-note">${noData} envio(s) sem questões não entram na classificação.</p>` : ""}
  `;
}

function renderInsights(rows, totals) {
  const target = $("#analysis-insights");

  if (!rows.length) {
    target.innerHTML = `<p><i></i>Ainda não existem envios para este caderno.</p>`;
    return;
  }

  const notes = [
    `Progresso médio da turma: ${totals.average}%. Acertos registrados: ${totals.correct}. Erros registrados: ${totals.incorrect}.`
  ];

  const illusion = rows.filter(row => row.category.id === "ilusao");
  const dominant = rows.filter(row => row.editing?.paste_dominant);
  const attention = rows.filter(row => row.band.id === "atencao");

  if (attention.length) {
    notes.push(`${attention.length} estudante(s) na faixa de atenção (menos de ${ANALYSIS.consolidationMin}% de acertos).`);
  }

  if (illusion.length) {
    notes.push(`${illusion.length} estudante(s) em ilusão de compreensão: escreveram sínteses longas, mas erraram a maior parte das questões. Vale revisar o conceito com eles.`);
  }

  if (dominant.length) {
    notes.push(`${dominant.length} síntese(s) com colagem predominante: o texto pode não ser autoral.`);
  }

  $("#analysis-insights").innerHTML = notes
    .map(note => `<p><i></i>${escapeHtml(note)}</p>`)
    .join("");
}

function drawPie(canvasId, values, labels, colors, legendId) {
  const canvas = $(`#${canvasId}`);
  const legend = $(`#${legendId}`);

  if (!canvas || !legend) return;

  const ctx = canvas.getContext("2d");
  const total = values.reduce((sum, value) => sum + value, 0);
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(canvas.width, canvas.height) * .36;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!total) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#252d4b";
    ctx.fill();

    legend.innerHTML = "<span>Nenhum dado disponível.</span>";
    return;
  }

  let angle = -Math.PI / 2;

  values.forEach((value, index) => {
    if (!value) return;

    const slice = value / total * Math.PI * 2;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = colors[index];
    ctx.fill();

    angle += slice;
  });

  legend.innerHTML = labels.map((label, index) => `
    <span class="chart-legend-item">
      <i style="background:${colors[index]}"></i>
      <span>${Math.round((values[index] || 0) / total * 100)}% ${escapeHtml(label)}</span>
    </span>
  `).join("");
}

function exportAnalysis() {
  const header = [
    "estudante", "codigo", "envio", "acertos", "total_questoes",
    "percentual_acerto", "faixa", "categoria", "progresso",
    "palavras", "caracteres", "paragrafos", "quebras_linha",
    "tempo_leitura_s", "tempo_sintese_s", "tempo_questoes_s",
    "eventos_colar", "caracteres_colados", "colagem_predominante",
    "apagamentos", "taxa_reescrita"
  ];

  const rows = (state.analysisRows || []).map(row => [
    row.item.student_name || "",
    row.item.student_code || "",
    row.item.submitted_at || "",
    row.item.score ?? "",
    row.item.total_questions ?? "",
    row.accuracy ?? "",
    row.band.label,
    row.category.label,
    row.item.progress ?? "",
    row.text.words,
    row.text.chars,
    row.text.paragraphs,
    row.text.line_breaks,
    row.seconds?.leitura ?? "",
    row.seconds?.sintese ?? "",
    row.seconds?.questoes ?? "",
    row.editing?.paste_events ?? "",
    row.editing?.pasted_chars ?? "",
    row.editing ? (row.editing.paste_dominant ? "sim" : "nao") : "",
    row.editing?.deletions ?? "",
    row.editing?.deletion_rate ?? ""
  ]);

  const csv = "\ufeff" + [header, ...rows]
    .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(";"))
    .join("\n");

  downloadBlob(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    "nexusnote-analise.csv"
  );
}
