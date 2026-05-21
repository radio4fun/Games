// Gerador automático de perguntas com base em arquivos
// nomeados como "imagem-1.png", "imagem-2.png", ...
// colocados na pasta "assets" na raiz do projeto.
//
// IMPORTANTE:
// - O navegador não consegue "listar" uma pasta local,
//   então precisamos de um número máximo de imagens
//   para tentar carregar (TOTAL_IMAGENS).
// - Para cada índice i, o script tenta carregar
//   "assets/imagem-i.png". Se não existir, é ignorado.
//
// Exemplo:
//   assets/imagem-1.png
//   assets/imagem-2.png
//   assets/imagem-3.png
//
// Se quiser integrar um modelo de IA real (OpenAI, etc.),
// basta substituir a função generateQuestionText por uma
// chamada de API que devolva o enunciado e as alternativas.

const TOTAL_IMAGENS = 20; // ajuste aqui a quantidade MÁXIMA
const IMAGE_BASENAME = "imagem-";
const IMAGE_EXTENSION = "png";

// "IA" simplificada: gera textos automaticamente.
// Aqui é apenas lógica de código; para usar uma IA de verdade
// você pode trocar por chamada de API.
function generateQuestionText(index) {
  const base =
    "Observe a imagem neurológica abaixo e escolha a alternativa que melhor descreve a estrutura em destaque.";

  return `${base} (Imagem ${index})`;
}

// Também geramos um "rótulo" genérico para a resposta correta.
// Em uma versão com IA real, isso deveria ser algo como
// "Hipocampo", "Cerebelo", etc., retornado pela API.
function generateAnswerLabel(index) {
  return `Estrutura da imagem ${index}`;
}

// Construímos a lista de questões dinamicamente.
// O filtro de imagens válidas acontece em quiz.js,
// quando a imagem não carregar.
function buildQuestions() {
  const questions = [];

  for (let i = 1; i <= TOTAL_IMAGENS; i++) {
    const id = `q${i}`;
    const image = `assets/${IMAGE_BASENAME}${i}.${IMAGE_EXTENSION}`;

    questions.push({
      id,
      image,
      answer: generateAnswerLabel(i),
      prompt: generateQuestionText(i),
    });
  }

  return questions;
}

const QUESTIONS = buildQuestions();
