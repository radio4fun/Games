// Utilidades
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(text) {
  if (text == null) return "";
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

/** Avisos únicos (arquivo + mensagem) */
const warningKeysSeen = new Set();

function warningKey(w) {
  return `${w.code || "warn"}|${w.file || ""}|${w.message || ""}`;
}

let globalWarningsList = [];

function ingestWarnings(namingWarnings, contentWarnings) {
  const incoming = [...(namingWarnings || []), ...(contentWarnings || [])];
  for (const w of incoming) {
    if (!w || typeof w.message !== "string") continue;
    const k = warningKey(w);
    if (warningKeysSeen.has(k)) continue;
    warningKeysSeen.add(k);
    globalWarningsList.push({
      code: w.code || "warn",
      file: w.file || "",
      message: w.message,
    });
  }
  renderWarningsBanner();
}

function renderWarningsBanner() {
  const banner = document.getElementById("warnings-banner");
  const listEl = document.getElementById("warnings-list");
  if (!banner || !listEl) return;

  if (globalWarningsList.length === 0) {
    banner.classList.add("hidden");
    return;
  }

  banner.classList.remove("hidden");
  listEl.innerHTML = "";
  globalWarningsList.forEach((w) => {
    const li = document.createElement("li");
    li.className = "warnings-item";
    const filePart = w.file
      ? `<span class="warnings-file">${escapeHtml(w.file)}</span> — `
      : "";
    li.innerHTML = `${filePart}${escapeHtml(w.message)}`;
    listEl.appendChild(li);
  });
}

// Estado do quiz e carregamento
let QUESTIONS = [];
let currentIndex = 0;
let score = 0;
let hasAnsweredCurrent = false;

let questionsLoading = false;
let questionsReady = false;
let questionsLoadError = null;
let userRequestedStart = false;
let mergeInProgress = false;

const welcomeOverlay = document.getElementById("welcome-overlay");
const waitingOverlay = document.getElementById("waiting-overlay");
const startQuizButton = document.getElementById("start-quiz-button");
const welcomeStatusText = document.getElementById("welcome-status-text");
const welcomeErrorEl = document.getElementById("welcome-error");
const waitingBackButton = document.getElementById("waiting-back-button");

const quizQuestionView = document.getElementById("quiz-question-view");
const quizResultsView = document.getElementById("quiz-results-view");

const questionImageEl = document.getElementById("question-image");
const questionTextEl = document.getElementById("question-text");
const optionsContainerEl = document.getElementById("options-container");
const feedbackEl = document.getElementById("feedback");
const nextButtonEl = document.getElementById("next-button");
const restartButtonEl = document.getElementById("restart-button");
const questionCounterEl = document.getElementById("question-counter");
const progressBarFillEl = document.getElementById("progress-bar-fill");

const resultsScoreValue = document.getElementById("results-score-value");
const resultsTotalValue = document.getElementById("results-total-value");
const resultsPercentValue = document.getElementById("results-percent-value");
const resultsMessage = document.getElementById("results-message");
const resultsIconEl = document.getElementById("results-icon");
const resultsRestartButton = document.getElementById("results-restart-button");
const resultsLoadNewButton = document.getElementById("results-load-new-button");
const resultsMergeStatus = document.getElementById("results-merge-status");

const warningsDismissBtn = document.getElementById("warnings-dismiss");

const OPTION_KEYS = ["A", "B", "C", "D"];

function showWelcome() {
  welcomeOverlay.classList.remove("hidden");
  welcomeOverlay.setAttribute("aria-hidden", "false");
}

function hideWelcome() {
  welcomeOverlay.classList.add("hidden");
  welcomeOverlay.setAttribute("aria-hidden", "true");
}

function showWaiting() {
  waitingOverlay.classList.remove("hidden");
  waitingOverlay.setAttribute("aria-hidden", "false");
}

function hideWaiting() {
  waitingOverlay.classList.add("hidden");
  waitingOverlay.setAttribute("aria-hidden", "true");
}

function showQuestionView() {
  quizQuestionView.classList.remove("hidden");
  quizResultsView.classList.add("hidden");
}

function showResultsView() {
  quizQuestionView.classList.add("hidden");
  quizResultsView.classList.remove("hidden");
  if (resultsMergeStatus) {
    resultsMergeStatus.classList.add("hidden");
    resultsMergeStatus.textContent = "";
  }
  setLoadNewButtonState();
}

function setLoadNewButtonState() {
  if (!resultsLoadNewButton) return;
  resultsLoadNewButton.disabled = mergeInProgress || questionsLoading;
}

function updateWelcomeStatus() {
  if (questionsLoadError) {
    welcomeStatusText.textContent = "Não foi possível carregar as perguntas.";
    welcomeErrorEl.textContent = questionsLoadError;
    welcomeErrorEl.classList.remove("hidden");
    return;
  }
  if (questionsReady) {
    welcomeStatusText.textContent = "Perguntas prontas. Toque em Iniciar quando quiser.";
    welcomeErrorEl.classList.add("hidden");
    return;
  }
  if (questionsLoading) {
    welcomeStatusText.textContent = "Gerando perguntas com IA…";
    welcomeErrorEl.classList.add("hidden");
  }
}

function updateProgress() {
  const total = QUESTIONS.length || 1;
  const current = Math.min(currentIndex + 1, total);
  questionCounterEl.textContent = `Pergunta ${current} / ${total}`;

  const percentage = (current / total) * 100;
  progressBarFillEl.style.width = `${percentage}%`;
}

function renderQuestion() {
  showQuestionView();

  if (!QUESTIONS || QUESTIONS.length === 0) {
    questionTextEl.textContent =
      "Nenhuma pergunta disponível. Verifique se o servidor está rodando e se há imagens em assets/.";
    nextButtonEl.disabled = true;
    restartButtonEl.classList.add("hidden");
    return;
  }

  if (currentIndex >= QUESTIONS.length) {
    renderResults();
    return;
  }

  const question = QUESTIONS[currentIndex];
  hasAnsweredCurrent = false;
  feedbackEl.textContent = "";
  feedbackEl.className = "feedback";
  nextButtonEl.disabled = true;
  restartButtonEl.classList.add("hidden");

  questionImageEl.removeAttribute("src");
  questionImageEl.alt = "";
  questionImageEl.src = question.image;
  questionImageEl.alt = "Imagem da pergunta";
  questionImageEl.onerror = () => {
    questionImageEl.alt =
      "Imagem não encontrada. Verifique o arquivo em assets/.";
  };

  questionTextEl.textContent = question.prompt || "Analise a imagem acima.";

  const raw = [question.answer, ...(question.distractors || [])];
  if (raw.length < 4) {
    questionTextEl.textContent =
      "Pergunta inválida (alternativas incompletas). Avance ou reinicie.";
    optionsContainerEl.innerHTML = "";
    nextButtonEl.disabled = false;
    return;
  }

  const options = shuffle([question.answer, ...question.distractors]);
  optionsContainerEl.innerHTML = "";

  options.forEach((optionText, index) => {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.dataset.isCorrect = optionText === question.answer ? "true" : "false";

    const keySpan = document.createElement("span");
    keySpan.className = "option-key";
    keySpan.textContent = OPTION_KEYS[index] ?? "?";

    const labelSpan = document.createElement("span");
    labelSpan.className = "option-label";
    labelSpan.textContent = optionText;

    btn.appendChild(keySpan);
    btn.appendChild(labelSpan);

    btn.addEventListener("click", () => handleOptionClick(btn));

    optionsContainerEl.appendChild(btn);
  });

  updateProgress();
}

function handleOptionClick(optionButton) {
  if (hasAnsweredCurrent) return;
  hasAnsweredCurrent = true;

  const isCorrect = optionButton.dataset.isCorrect === "true";

  const allButtons = optionsContainerEl.querySelectorAll(".option");
  allButtons.forEach((btn) => {
    btn.classList.add("disabled");
    if (btn.dataset.isCorrect === "true") {
      btn.classList.add("correct", "reveal");
    }
  });

  optionButton.classList.add("selected");
  optionButton.classList.add(isCorrect ? "correct" : "incorrect");

  if (isCorrect) {
    score++;
    feedbackEl.className = "feedback feedback--correct";
    feedbackEl.innerHTML =
      '<span class="correct"><strong>Correto!</strong></span> Muito bem.';
  } else {
    const currentQuestion = QUESTIONS[currentIndex];
    feedbackEl.className = "feedback feedback--incorrect";
    feedbackEl.innerHTML = `<span class="incorrect"><strong>Incorreto.</strong></span> Resposta certa: <strong>${escapeHtml(
      currentQuestion.answer
    )}</strong>.`;
  }

  nextButtonEl.disabled = false;
  if (currentIndex === QUESTIONS.length - 1) {
    nextButtonEl.textContent = "Ver resultado";
  } else {
    nextButtonEl.textContent = "Próxima";
  }
}

function renderResults() {
  const total = QUESTIONS.length;
  const wrong = total - score;
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

  showResultsView();

  resultsScoreValue.textContent = String(score);
  resultsTotalValue.textContent = String(total);
  resultsPercentValue.textContent = `${percentage}%`;

  let msg = "";
  if (percentage >= 90) {
    msg = "Excelente! Domínio muito sólido do conteúdo.";
    if (resultsIconEl) resultsIconEl.textContent = "★";
  } else if (percentage >= 70) {
    msg = "Muito bom! Continue praticando para refinar os detalhes.";
    if (resultsIconEl) resultsIconEl.textContent = "✓";
  } else if (percentage >= 50) {
    msg = "Bom começo — revise as estruturas que errou e tente de novo.";
    if (resultsIconEl) resultsIconEl.textContent = "◆";
  } else {
    msg = "Há espaço para evoluir — continue estudando e você se sairá melhor.";
    if (resultsIconEl) resultsIconEl.textContent = "↑";
  }
  resultsMessage.textContent = `${msg} Você errou ${wrong} de ${total} ${
    total === 1 ? "pergunta" : "perguntas"
  }.`;

  questionCounterEl.textContent = "Quiz concluído";
  progressBarFillEl.style.width = "100%";

  nextButtonEl.disabled = true;
  restartButtonEl.classList.add("hidden");
}

function goToNextQuestion() {
  if (currentIndex < QUESTIONS.length) {
    currentIndex++;
    renderQuestion();
  }
}

function restartQuiz() {
  currentIndex = 0;
  score = 0;
  hasAnsweredCurrent = false;
  nextButtonEl.textContent = "Próxima";
  showQuestionView();
  renderQuestion();
}

function mergeQuestionsUnique(existing, incoming) {
  const seen = new Set(existing.map((q) => q.image));
  const added = [];
  for (const q of incoming) {
    if (!q || !q.image) continue;
    if (seen.has(q.image)) continue;
    seen.add(q.image);
    added.push(q);
  }
  return { merged: [...existing, ...added], addedCount: added.length };
}

nextButtonEl.addEventListener("click", goToNextQuestion);
restartButtonEl.addEventListener("click", restartQuiz);
resultsRestartButton.addEventListener("click", restartQuiz);

if (warningsDismissBtn) {
  warningsDismissBtn.addEventListener("click", () => {
    const banner = document.getElementById("warnings-banner");
    if (banner) banner.classList.add("hidden");
  });
}

if (resultsLoadNewButton) {
  resultsLoadNewButton.addEventListener("click", async () => {
    if (mergeInProgress) return;
    mergeInProgress = true;
    setLoadNewButtonState();
    if (resultsLoadNewButton) {
      resultsLoadNewButton.textContent = "Consultando pasta…";
    }

    try {
      const existingImagePaths = QUESTIONS.map((q) => q.image);
      const res = await fetch("/api/questions/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ existingImagePaths }),
      });

      if (!res.ok) {
        throw new Error("Falha ao buscar novas perguntas.");
      }

      const data = await res.json();
      ingestWarnings(data.namingWarnings, data.contentWarnings);

      const incoming = data.questions || [];
      const { merged, addedCount } = mergeQuestionsUnique(QUESTIONS, incoming);
      QUESTIONS = merged;

      if (resultsMergeStatus) {
        resultsMergeStatus.classList.remove("hidden");
        if (data.message && addedCount === 0) {
          resultsMergeStatus.textContent = data.message;
        } else if (addedCount > 0) {
          resultsMergeStatus.textContent = `${addedCount} nova(s) pergunta(s) adicionada(s). Na próxima rodada (“Fazer de novo”) o quiz terá ${QUESTIONS.length} pergunta(s).`;
        } else {
          resultsMergeStatus.textContent =
            "Nenhuma imagem nova com padrão correto encontrada.";
        }
      }
    } catch (e) {
      console.error(e);
      if (resultsMergeStatus) {
        resultsMergeStatus.classList.remove("hidden");
        resultsMergeStatus.textContent =
          "Não foi possível atualizar. Verifique o servidor.";
      }
    } finally {
      mergeInProgress = false;
      if (resultsLoadNewButton) {
        resultsLoadNewButton.textContent = "Carregar novas imagens da pasta";
      }
      setLoadNewButtonState();
    }
  });
}

function beginQuizFromWelcome() {
  hideWelcome();
  hideWaiting();
  currentIndex = 0;
  score = 0;
  hasAnsweredCurrent = false;
  nextButtonEl.textContent = "Próxima";
  renderQuestion();
}

function handleStartClick() {
  welcomeErrorEl.classList.add("hidden");

  if (questionsLoadError) {
    welcomeErrorEl.textContent = questionsLoadError;
    welcomeErrorEl.classList.remove("hidden");
    return;
  }

  if (questionsReady && QUESTIONS.length > 0) {
    beginQuizFromWelcome();
    return;
  }

  if (questionsLoading) {
    userRequestedStart = true;
    hideWelcome();
    showWaiting();
    return;
  }

  welcomeErrorEl.textContent =
    "Ainda não há perguntas. Aguarde o carregamento ou verifique o servidor.";
  welcomeErrorEl.classList.remove("hidden");
}

function tryFinishWaitingIfReady() {
  if (!userRequestedStart || questionsLoading) return;

  if (questionsLoadError) {
    hideWaiting();
    showWelcome();
    welcomeErrorEl.textContent = questionsLoadError;
    welcomeErrorEl.classList.remove("hidden");
    updateWelcomeStatus();
    userRequestedStart = false;
    return;
  }

  if (questionsReady && QUESTIONS.length === 0) {
    hideWaiting();
    showWelcome();
    welcomeErrorEl.textContent =
      "Nenhuma pergunta foi gerada. Adicione imagens válidas em assets/ (imagem-1, imagem-2…) ou veja os avisos acima.";
    welcomeErrorEl.classList.remove("hidden");
    updateWelcomeStatus();
    userRequestedStart = false;
    return;
  }

  if (questionsReady && QUESTIONS.length > 0) {
    userRequestedStart = false;
    beginQuizFromWelcome();
  }
}

async function loadQuestions() {
  questionsLoading = true;
  questionsReady = false;
  questionsLoadError = null;
  updateWelcomeStatus();
  setLoadNewButtonState();

  try {
    const response = await fetch("/api/questions");
    if (!response.ok) {
      throw new Error("Falha ao carregar perguntas (servidor).");
    }
    const data = await response.json();
    ingestWarnings(data.namingWarnings, data.contentWarnings);
    QUESTIONS = data.questions || [];

    if (QUESTIONS.length === 0) {
      questionsLoadError =
        "Nenhuma pergunta disponível: confira imagens nomeadas (imagem-1, …), extensão no .env e avisos abaixo.";
    }

    questionsReady = true;
  } catch (err) {
    console.error(err);
    questionsLoadError =
      "Erro ao carregar perguntas. Verifique se o servidor está rodando (npm start).";
    questionsReady = false;
  } finally {
    questionsLoading = false;
    updateWelcomeStatus();
    tryFinishWaitingIfReady();
    setLoadNewButtonState();
  }
}

startQuizButton.addEventListener("click", handleStartClick);

waitingBackButton.addEventListener("click", () => {
  userRequestedStart = false;
  hideWaiting();
  showWelcome();
  updateWelcomeStatus();
});

document.addEventListener("DOMContentLoaded", () => {
  showWelcome();
  hideWaiting();
  showQuestionView();
  quizQuestionView.classList.add("hidden");
  loadQuestions();
});
