import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const __dirname = path.resolve();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const TOTAL_IMAGES = parseInt(process.env.TOTAL_IMAGES || "20", 10);
const IMAGE_EXTENSION = (process.env.IMAGE_EXTENSION || "png").toLowerCase();

app.use(express.json({ limit: "10mb" }));

app.use(express.static(__dirname));

const IMAGE_EXT_PATTERN = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;

/** Arquivos em assets/ que parecem imagem mas não seguem imagem-N.<ext configurado> */
function collectNamingAndFormatWarnings() {
  const assetsDir = path.join(__dirname, "assets");
  const warnings = [];

  if (!fs.existsSync(assetsDir)) {
    return warnings;
  }

  const files = fs.readdirSync(assetsDir);
  for (const file of files) {
    const fullPath = path.join(assetsDir, file);
    if (!fs.statSync(fullPath).isFile()) continue;

    const match = file.match(/^imagem-(\d+)\.([^.]+)$/i);
    if (match) {
      const ext = match[2].toLowerCase();
      if (ext !== IMAGE_EXTENSION) {
        warnings.push({
          code: "wrong_extension",
          file,
          message: `“${file}” usa .${ext}, mas IMAGE_EXTENSION no .env é “${IMAGE_EXTENSION}”. Ajuste o nome ou o .env.`,
        });
      }
    } else if (IMAGE_EXT_PATTERN.test(file)) {
      warnings.push({
        code: "wrong_name",
        file,
        message: `“${file}” não segue o padrão imagem-1.${IMAGE_EXTENSION}, imagem-2.${IMAGE_EXTENSION}, … e não será enviado à IA.`,
      });
    }
  }

  return warnings;
}

/** Somente imagens válidas para o quiz (padrão + extensão do .env) */
function listValidImagePaths() {
  const assetsDir = path.join(__dirname, "assets");
  const images = [];

  if (!fs.existsSync(assetsDir)) {
    return images;
  }

  for (let i = 1; i <= TOTAL_IMAGES; i++) {
    const filename = `imagem-${i}.${IMAGE_EXTENSION}`;
    const fullPath = path.join(assetsDir, filename);
    if (fs.existsSync(fullPath)) {
      images.push({
        id: `q${i}`,
        filePath: fullPath,
        publicPath: `/assets/${filename}`,
        index: i,
      });
    }
  }

  return images;
}

function stripJsonFromModelText(text) {
  let content = text || "";
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    content = codeBlockMatch[1].trim();
  }
  return content;
}

function parseModelJson(content) {
  const trimmed = stripJsonFromModelText(content);
  return JSON.parse(trimmed);
}

/** Valida objeto de pergunta; retorna null se inválido */
function normalizeQuestionPayload(parsed, imageMeta) {
  if (parsed?.skipped === true) {
    return {
      type: "skipped",
      reason:
        typeof parsed.reason === "string"
          ? parsed.reason
          : "Imagem considerada inadequada para o tema do quiz.",
    };
  }

  const prompt = parsed?.prompt;
  const answer = parsed?.answer;
  let distractors = parsed?.distractors;

  if (typeof prompt !== "string" || typeof answer !== "string") {
    return {
      type: "skipped",
      reason: "A IA não retornou pergunta no formato esperado.",
    };
  }

  if (!Array.isArray(distractors)) {
    return {
      type: "skipped",
      reason: "Alternativas incorretas ausentes ou inválidas.",
    };
  }

  distractors = distractors.filter((d) => typeof d === "string" && d.trim());
  if (distractors.length !== 3) {
    return {
      type: "skipped",
      reason: "É necessário exatamente 3 distratores.",
    };
  }

  const set = new Set(
    [answer, ...distractors].map((s) => s.trim().toLowerCase())
  );
  if (set.size !== 4) {
    return {
      type: "skipped",
      reason: "A resposta correta não pode ser igual a um distrator.",
    };
  }

  return {
    type: "ok",
    question: {
      id: imageMeta.id,
      image: imageMeta.publicPath,
      prompt: prompt.trim(),
      answer: answer.trim(),
      distractors: distractors.map((d) => d.trim()),
    },
  };
}

async function callGeminiForQuestion({ img, base64Image, mimeType }) {
  const index = img.index;

  if (!GEMINI_API_KEY) {
    const answer = `Estrutura neurológica ${index}`;
    return {
      ok: true,
      question: {
        id: img.id,
        image: img.publicPath,
        prompt: `Observe a imagem neurológica ${index} e selecione a alternativa que melhor descreve a estrutura em destaque.`,
        answer,
        distractors: [
          `Estrutura neurológica ${index + 1}`,
          `Estrutura neurológica ${index + 2}`,
          `Estrutura neurológica ${index + 3}`,
        ],
      },
    };
  }

  const apiUrl =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const instruction = `Você é um Estudante, ainda em curso, perguntas devem ser moderadamente faceis.

Analise a imagem. Ela deve ser adequada para um quiz de Tecnico em RADIOLOGIA (ex:Perguntas relacionadas a  Tipo de Exame solicitado, Lado (Esquerdo, direito, superior, inferior) da estrutura analisada, Possivel uso de Contraste, Possivel trauma em qual parte da estrutura, Osso).

Se a imagem NÃO for adequada (foto casual, meme, paisagem, documento sem relação, conteúdo ofensivo, arquivo ilegível ou sem relação com neuroanatomia/neuroimagem), responda APENAS com este JSON:
{"skipped": true, "reason": "breve explicação em português"}

Se for adequada, responda APENAS com este JSON (sem markdown):
{"prompt": "texto da pergunta", "answer": "alternativa correta", "distractors": ["incorreta 1", "incorreta 2", "incorreta 3"]}

Regras: português brasileiro; exatamente 3 distratores; distratores plausíveis e distintos da resposta correta.`;

  const response = await fetch(`${apiUrl}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: instruction },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.5,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Erro da API Gemini:", errText);
    throw new Error("Falha ao chamar a API Gemini");
  }

  const data = await response.json();

  if (!data.candidates?.length) {
    const reason =
      data.promptFeedback?.blockReason ||
      "A API não retornou candidatos (conteúdo bloqueado ou vazio).";
    return {
      ok: false,
      skipWarning: {
        file: path.basename(img.filePath),
        message: String(reason),
      },
    };
  }

  let content = data.candidates[0]?.content?.parts?.[0]?.text || "";

  try {
    const parsed = parseModelJson(content);
    const normalized = normalizeQuestionPayload(parsed, {
      id: img.id,
      publicPath: img.publicPath,
    });

    if (normalized.type === "skipped") {
      return {
        ok: false,
        skipWarning: {
        file: path.basename(img.filePath),
        message: normalized.reason,
      },
    };
  }

  return { ok: true, question: normalized.question };
  } catch (e) {
    console.error("Falha ao parsear resposta da IA:", content, e);
    return {
      ok: false,
      skipWarning: {
        file: path.basename(img.filePath),
        message: "Resposta da IA ilegível ou fora do formato JSON esperado.",
      },
    };
  }
}

function mimeForConfiguredExtension() {
  const map = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
  };
  return map[IMAGE_EXTENSION] || `image/${IMAGE_EXTENSION}`;
}

/**
 * Gera questões para a lista de imagens; acumula avisos (IA / parse).
 */
async function generateQuestionsForImages(images) {
  const questions = [];
  const contentWarnings = [];
  const mimeType = mimeForConfiguredExtension();

  for (const img of images) {
    const fileBuffer = fs.readFileSync(img.filePath);
    const base64Image = fileBuffer.toString("base64");

    const result = await callGeminiForQuestion({
      img,
      base64Image,
      mimeType,
    });

    if (result.ok && result.question) {
      questions.push(result.question);
    } else if (result.skipWarning) {
      contentWarnings.push({
        code: "ai_rejected",
        file: result.skipWarning.file,
        message: result.skipWarning.message,
      });
    }
  }

  return { questions, contentWarnings };
}

async function handleQuestionsRequest(req, res, existingPathsSet) {
  try {
    const namingWarnings = collectNamingAndFormatWarnings();
    const allValid = listValidImagePaths();

    const toProcess = existingPathsSet
      ? allValid.filter((img) => !existingPathsSet.has(img.publicPath))
      : allValid;

    if (toProcess.length === 0 && !existingPathsSet) {
      return res.json({
        questions: [],
        namingWarnings,
        contentWarnings: [],
      });
    }

    if (toProcess.length === 0 && existingPathsSet) {
      return res.json({
        questions: [],
        namingWarnings,
        contentWarnings: [],
        message: "Nenhuma imagem nova encontrada em relação às já carregadas.",
      });
    }

    const { questions, contentWarnings } =
      await generateQuestionsForImages(toProcess);

    res.json({
      questions,
      namingWarnings,
      contentWarnings,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar perguntas" });
  }
}

app.get("/api/questions", async (req, res) => {
  await handleQuestionsRequest(req, res, null);
});

/** Corpo: { "existingImagePaths": ["/assets/imagem-1.png", ...] } — só gera para imagens ainda não listadas */
app.post("/api/questions/merge", async (req, res) => {
  const body = req.body || {};
  const existing = Array.isArray(body.existingImagePaths)
    ? body.existingImagePaths
    : [];
  const set = new Set(existing.filter((p) => typeof p === "string"));
  await handleQuestionsRequest(req, res, set);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
