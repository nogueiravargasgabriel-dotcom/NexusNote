"use strict";

/*
 * Complemento visual e aba de gestão de alunos.
 * Requer as funções nexusnote_list_students e nexusnote_assign_student_class
 * criadas pelo arquivo alunosbanco.sql.
 */

(function () {
  let initialized = false;
  let students = [];
  let classes = [];
  let busy = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&")
      .replaceAll("<", "<")
      .replaceAll(">", ">")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function initialize() {
    if (initialized) return;
    initialized = true;

    const dashboard = document.querySelector(".teacher-dashboard");
    if (!dashboard) return;

    dashboard.classList.add("teacher-dashboard-ready");

    const profile = document.querySelector(".teacher-profile-card");
    if (profile) {
      profile.setAttribute("aria-label", "Perfil do professor");
    }

    const notebookForm = document.querySelector("#notebook-form");
    if (notebookForm) {
      notebookForm.setAttribute("novalidate", "novalidate");
    }

    addStudentTab();
  }

  function addStudentTab() {
    const dashboard = document.querySelector(".teacher-dashboard");
    const columns = dashboard?.querySelector(".teacher-columns");

    if (!dashboard || !columns || document.querySelector("#students-panel")) {
      return;
    }

    const navigation = document.createElement("nav");
    navigation.className = "student-management-tabs";
    navigation.setAttribute("aria-label", "Seções do painel docente");
    navigation.innerHTML = `
      <button type="button" class="outline-button active" data-teacher-tab="workspace">
        Cadernos e análise
      </button>
      <button type="button" class="outline-button" data-teacher-tab="students">
        Alunos
      </button>
    `;

    const panel = document.createElement("section");
    panel.id = "students-panel";
    panel.className = "students-panel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="column-heading">
        <span class="eyebrow">Gestão da turma</span>
        <h2>Alunos cadastrados.</h2>
        <p>Consulte as contas de estudante e atribua uma turma. Novos cadastros aparecem sem turma atribuída.</p>
      </div>

      <div class="students-toolbar">
        <label>
          Buscar aluno
          <input id="students-search" type="search" placeholder="Nome ou e-mail">
        </label>
        <button id="students-refresh" class="outline-button" type="button">
          Atualizar lista
        </button>
      </div>

      <p id="students-status" class="status" role="status" aria-live="polite"></p>
      <div id="students-list" class="students-list"></div>
    `;

    columns.before(navigation);
    columns.after(panel);

    navigation.addEventListener("click", event => {
      const button = event.target.closest("[data-teacher-tab]");
      if (!button) return;

      const showStudents = button.dataset.teacherTab === "students";
      columns.hidden = showStudents;
      panel.hidden = !showStudents;

      navigation.querySelectorAll("[data-teacher-tab]").forEach(tab => {
        tab.classList.toggle("active", tab === button);
        tab.setAttribute("aria-pressed", String(tab === button));
      });

      if (showStudents) {
        loadStudents();
      }
    });

    panel.addEventListener("click", event => {
      if (event.target.closest("#students-refresh")) {
        loadStudents();
      }
    });

    panel.addEventListener("input", event => {
      if (event.target.id === "students-search") {
        renderStudents();
      }
    });

    panel.addEventListener("change", event => {
      const select = event.target.closest("[data-student-class]");
      if (select) assignClass(select);
    });
  }

  async function loadStudents() {
    const target = document.querySelector("#students-list");
    const status = document.querySelector("#students-status");

    if (!target || busy) return;

    const client = window.supabaseClient;
    if (!client) {
      status.textContent = "A conexão com o Supabase não está disponível.";
      return;
    }

    busy = true;
    status.textContent = "Carregando alunos...";
    target.innerHTML = "";

    try {
      const [studentResponse, classResponse] = await Promise.all([
        client.rpc("nexusnote_list_students"),
        client.from("classes").select("id,name").order("name", { ascending: true })
      ]);

      if (studentResponse.error) throw studentResponse.error;
      if (classResponse.error) throw classResponse.error;

      students = Array.isArray(studentResponse.data)
        ? studentResponse.data
        : [];
      classes = Array.isArray(classResponse.data)
        ? classResponse.data
        : [];

      status.textContent = students.length
        ? `${students.length} aluno(s) encontrado(s).`
        : "Ainda não há contas de estudante cadastradas.";

      renderStudents();
    } catch (error) {
      console.error("Erro ao carregar alunos:", error);
      status.textContent =
        "Não foi possível carregar os alunos. Confira se o script alunosbanco.sql foi executado e se sua conta tem perfil de professor.";
      target.innerHTML = "";
    } finally {
      busy = false;
    }
  }

  function renderStudents() {
    const target = document.querySelector("#students-list");
    if (!target) return;

    const query = (
      document.querySelector("#students-search")?.value || ""
    ).trim().toLocaleLowerCase("pt-BR");

    const filtered = students.filter(student => {
      const searchable = `${student.full_name || ""} ${student.email || ""}`
        .toLocaleLowerCase("pt-BR");
      return searchable.includes(query);
    });

    if (!filtered.length) {
      target.innerHTML = `
        <div class="empty-state">
          ${students.length
            ? "Nenhum aluno corresponde à busca."
            : "Nenhum aluno cadastrado."}
        </div>
      `;
      return;
    }

    target.innerHTML = filtered.map(student => {
      const selectedClass = student.class_id
        ? String(student.class_id)
        : "";

      const options = classes.map(item => `
        <option value="${escapeHtml(item.id)}"
          ${String(item.id) === selectedClass ? "selected" : ""}>
          ${escapeHtml(item.name)}
        </option>
      `).join("");

      return `
        <article class="student-management-card">
          <div class="student-management-identity">
            <strong>${escapeHtml(student.full_name || "Nome não informado")}</strong>
            <span>${escapeHtml(student.email || "E-mail não informado")}</span>
          </div>

          <label>
            Turma
            <select data-student-class="${escapeHtml(student.id)}"
              aria-label="Atribuir turma para ${escapeHtml(student.full_name || student.email || "aluno")}">
              <option value="">Sem turma atribuída</option>
              ${options}
            </select>
          </label>
        </article>
      `;
    }).join("");
  }

  async function assignClass(select) {
    if (busy) return;

    const studentId = select.dataset.studentClass;
    const classId = select.value || null;
    const previous = students.find(
      student => String(student.id) === String(studentId)
    )?.class_id || null;

    select.disabled = true;

    try {
      const response = await window.supabaseClient.rpc(
        "nexusnote_assign_student_class",
        {
          p_student_id: studentId,
          p_class_id: classId
        }
      );

      if (response.error) throw response.error;

      const student = students.find(
        item => String(item.id) === String(studentId)
      );

      if (student) {
        student.class_id = classId;
        student.class_name = classes.find(
          item => String(item.id) === String(classId)
        )?.name || null;
      }

      const status = document.querySelector("#students-status");
      status.textContent = classId
        ? "Turma atribuída ao aluno."
        : "Atribuição de turma removida.";
    } catch (error) {
      console.error("Erro ao atribuir turma:", error);
      select.value = previous ? String(previous) : "";
      document.querySelector("#students-status").textContent =
        "Não foi possível salvar a turma. Confira as permissões e a configuração do banco.";
    } finally {
      select.disabled = false;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();