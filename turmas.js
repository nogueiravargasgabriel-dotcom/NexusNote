"use strict";

/* ==========================================================================
   NexusNote · turmas.js
   Cadastro de turmas, escolha da turma pelo estudante, filtro da análise
   e correção da turma de um envio pelo professor.
   Carregue ANTES do app.js. As funções usam helpers do app.js ($, text,
   escapeHtml, escapeAttribute, showToast, state) apenas no momento da chamada.
   ========================================================================== */

const CLASSES_TABLE = "classes";
const NO_CLASS_FILTER = "__sem_turma__";

const classStore = {
  list: [],
  loaded: false,
  busy: false
};

function classesAvailable() {
  return classStore.list.length > 0;
}

function sortClasses(list) {
  return [...list].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "pt-BR", { numeric: true })
  );
}

async function fetchClasses() {
  const response = await window.supabaseClient
    .from(CLASSES_TABLE)
    .select("*")
    .order("name", { ascending: true });

  if (response.error) {
    console.error(response.error);
    classStore.list = [];
    return false;
  }

  classStore.list = sortClasses(response.data || []);
  classStore.loaded = true;
  return true;
}

/* ---------- Professor: cadastro ---------- */

async function loadClasses() {
  const ok = await fetchClasses();

  if (!ok) {
    text("#class-status", "Não foi possível carregar as turmas. Rode o script do banco.");
  }

  renderClassList();
  renderClassFilter();
  renderClassDatalist();
}

function renderClassList() {
  const target = $("#class-list");
  if (!target) return;

  target.innerHTML = classStore.list.length
    ? classStore.list.map(item => `
        <div class="class-chip">
          <strong>${escapeHtml(item.name)}</strong>
          ${item.description ? `<small>${escapeHtml(item.description)}</small>` : ""}
          <button class="outline-button" type="button" data-edit-class="${escapeAttribute(item.id)}">Editar</button>
          <button class="remove-button" type="button" data-delete-class="${escapeAttribute(item.id)}">Excluir</button>
        </div>
      `).join("")
    : `<div class="empty-state">Nenhuma turma cadastrada.</div>`;
}

function renderClassDatalist() {
  const list = $("#class-options");
  if (!list) return;

  list.innerHTML = classStore.list
    .map(item => `<option value="${escapeAttribute(item.name)}"></option>`)
    .join("");
}

function renderClassFilter() {
  const select = $("#analysis-class");
  if (!select) return;

  const previous = select.value;

  select.innerHTML = `
    <option value="">Todas as turmas</option>
    ${classStore.list.map(item => `
      <option value="${escapeAttribute(item.id)}">${escapeHtml(item.name)}</option>
    `).join("")}
    <option value="${NO_CLASS_FILTER}">Sem turma</option>
  `;

  if ([...select.options].some(option => option.value === previous)) {
    select.value = previous;
  }
}

function resetClassForm() {
  $("#class-id").value = "";
  $("#class-name").value = "";
  $("#class-description").value = "";
  $("#class-submit").textContent = "Cadastrar turma";
  $("#class-cancel").hidden = true;
}

async function saveClass(event) {
  event.preventDefault();
  if (classStore.busy) return;

  const id = $("#class-id").value;
  const name = $("#class-name").value.trim();
  const description = $("#class-description").value.trim();

  if (!name) {
    text("#class-status", "Informe o nome da turma.");
    return;
  }

  const duplicate = classStore.list.some(item =>
    item.name.trim().toLowerCase() === name.toLowerCase() &&
    String(item.id) !== String(id)
  );

  if (duplicate) {
    text("#class-status", "Já existe uma turma com esse nome.");
    return;
  }

  classStore.busy = true;
  text("#class-status", "Salvando turma...");

  const payload = { name, description: description || null };

  const response = id
    ? await window.supabaseClient.from(CLASSES_TABLE).update(payload).eq("id", id)
    : await window.supabaseClient.from(CLASSES_TABLE).insert({
        ...payload,
        created_by: state.user?.id || null
      });

  classStore.busy = false;

  if (response.error) {
    console.error(response.error);
    text("#class-status", "Não foi possível salvar a turma.");
    return;
  }

  /* Renomeou: mantém o nome atualizado nos envios já vinculados. */
  if (id) {
    await window.supabaseClient
      .from(SUBMISSIONS_TABLE)
      .update({ class_name: name })
      .eq("class_id", id);
  }

  text("#class-status", id ? "Turma atualizada." : "Turma cadastrada.");
  resetClassForm();
  await loadClasses();
  refreshAnalysisView();
}

function editClass(id) {
  const item = classStore.list.find(entry => String(entry.id) === String(id));
  if (!item) return;

  $("#class-id").value = item.id;
  $("#class-name").value = item.name;
  $("#class-description").value = item.description || "";
  $("#class-submit").textContent = "Salvar alterações";
  $("#class-cancel").hidden = false;
  $("#class-name").focus();
}

async function deleteClass(id) {
  const item = classStore.list.find(entry => String(entry.id) === String(id));
  if (!item) return;

  if (!confirm(`Excluir a turma "${item.name}"? Os envios ficarão sem turma.`)) return;

  const response = await window.supabaseClient
    .from(CLASSES_TABLE)
    .delete()
    .eq("id", id);

  if (response.error) {
    console.error(response.error);
    text("#class-status", "Não foi possível excluir a turma.");
    return;
  }

  text("#class-status", "Turma excluída.");
  await loadClasses();
  if (typeof loadAnalysis === "function") loadAnalysis();
}

/* ---------- Análise: filtro e correção ---------- */

function submissionClassName(item) {
  if (item.class_id) {
    const found = classStore.list.find(entry => String(entry.id) === String(item.class_id));
    if (found) return found.name;
  }

  return item.class_name || "";
}

function filterSubmissionsByClass(submissions) {
  const filter = $("#analysis-class")?.value || "";
  if (!filter) return submissions;

  if (filter === NO_CLASS_FILTER) {
    return submissions.filter(item => !item.class_id);
  }

  return submissions.filter(item => String(item.class_id) === String(filter));
}

function refreshAnalysisView() {
  if (typeof renderAnalysis !== "function") return;
  renderAnalysis(filterSubmissionsByClass(state.submissions || []));
}

function renderSubmissionClassCell(item) {
  const current = item.class_id ? String(item.class_id) : "";
  const orphanName = !current && item.class_name ? item.class_name : "";

  return `
    <select class="class-select-inline" data-submission-class="${escapeAttribute(item.id)}" aria-label="Alterar turma do envio">
      <option value="">${orphanName ? escapeHtml(`${orphanName} (não cadastrada)`) : "Sem turma"}</option>
      ${classStore.list.map(entry => `
        <option value="${escapeAttribute(entry.id)}" ${String(entry.id) === current ? "selected" : ""}>
          ${escapeHtml(entry.name)}
        </option>
      `).join("")}
    </select>
  `;
}

async function changeSubmissionClass(select) {
  const submissionId = select.dataset.submissionClass;
  const classId = select.value || null;
  const chosen = classStore.list.find(entry => String(entry.id) === String(classId));
  const submission = (state.submissions || []).find(item => String(item.id) === String(submissionId));
  const previous = submission?.class_id || "";

  select.disabled = true;

  const response = await window.supabaseClient
    .from(SUBMISSIONS_TABLE)
    .update({ class_id: classId, class_name: chosen ? chosen.name : null })
    .eq("id", submissionId)
    .select("id");

  select.disabled = false;

  if (response.error || !response.data?.length) {
    console.error(response.error);
    select.value = previous;
    showToast("Não foi possível alterar a turma deste envio.");
    return;
  }

  if (submission) {
    submission.class_id = classId;
    submission.class_name = chosen ? chosen.name : null;
  }

  showToast(chosen ? `Envio movido para ${chosen.name}.` : "Envio ficou sem turma.");
  refreshAnalysisView();
}

/* ---------- Estudante: escolha da turma ---------- */

async function loadStudentClassOptions() {
  const select = $("#student-class");
  if (!select) return;

  await fetchClasses();

  const saved = localStorage.getItem("nexusnote-student-class") || "";

  select.innerHTML = `
    <option value="">${classStore.list.length ? "Selecione sua turma" : "Nenhuma turma cadastrada"}</option>
    ${classStore.list.map(item => `
      <option value="${escapeAttribute(item.id)}">${escapeHtml(item.name)}</option>
    `).join("")}
  `;

  if (classStore.list.some(item => String(item.id) === saved)) {
    select.value = saved;
  }
}

function getSelectedStudentClass() {
  const id = $("#student-class")?.value || "";
  const found = classStore.list.find(item => String(item.id) === id);

  return found
    ? { id: found.id, name: found.name }
    : { id: null, name: null };
}

/* ---------- Eventos ---------- */

function bindClasses() {
  $("#class-form")?.addEventListener("submit", saveClass);
  $("#class-cancel")?.addEventListener("click", resetClassForm);
  $("#analysis-class")?.addEventListener("change", refreshAnalysisView);

  $("#student-class")?.addEventListener("change", event => {
    localStorage.setItem("nexusnote-student-class", event.target.value);
  });

  document.addEventListener("click", event => {
    const edit = event.target.closest("[data-edit-class]");
    const remove = event.target.closest("[data-delete-class]");

    if (edit) editClass(edit.dataset.editClass);
    if (remove) deleteClass(remove.dataset.deleteClass);
  });

  document.addEventListener("change", event => {
    const select = event.target.closest("[data-submission-class]");
    if (select) changeSubmissionClass(select);
  });
}
