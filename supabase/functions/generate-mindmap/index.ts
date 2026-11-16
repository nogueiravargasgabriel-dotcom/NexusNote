import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      studentName = "",
      notebookTitle = "",
      subject = "",
      objective = "",
      keywords = [],
      studentTexts = [],
      teacherTexts = [],
      notes = "",
    } = await req.json();

    const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "GEMINI_API_KEY não configurada nos segredos do Supabase.",
          fallback: true,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const combinedStudentText = [
      ...studentTexts,
      notes ? `Anotações gerais: ${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const prompt = `Você é um assistente pedagógico especializado em criar sínteses e mapas mentais para estudantes na plataforma NexusNote.

DADOS DO ESTUDO:
- Estudante: ${studentName || "Estudante"}
- Caderno: ${notebookTitle}
- Componente/Matéria: ${subject}
- Objetivo de aprendizagem: ${objective || "Não informado"}
- Palavras-chave: ${keywords.join(", ") || "Não informadas"}

TEXTO PRODUZIDO PELO ESTUDANTE:
"""
${combinedStudentText || "O estudante realizou o estudo do caderno e acompanhou os materiais de apoio."}
"""

TEXTOS DE APOIO DO PROFESSOR:
"""
${teacherTexts.slice(0, 3).join("\n\n")}
"""

TAREFA:
Analise as anotações do estudante e o conteúdo de apoio.
Gere um JSON estrito com:
1. "summary":
   - "overview": síntese em 2 a 3 parágrafos claros, motivadores e bem articulados destacando o que o estudante aprendeu.
   - "keyPoints": array com 3 a 5 pontos-chave essenciais.
   - "connections": 1 parágrafo explicando as conexões com o cotidiano e aplicações práticas.
2. "branches": array de 4 a 6 ramos para o mapa mental, no formato:
   - "label": título do ramo (curto, 2 a 4 palavras, ex: "Conceito Central", "Aplicações Práticas", "Ideias do Estudante", "Pontos de Atenção").
   - "color": uma cor em hexadecimal entre: "#32d6ff" (ciano), "#7c6cff" (roxo), "#61e4b2" (verde), "#ffd166" (amarelo), "#ff8d9b" (rosa).
   - "items": array com 2 a 4 frases/tópicos curtos e objetivos (máximo 80 caracteres cada).

RESPONDA EXCLUSIVAMENTE COM O OBJETO JSON VÁLIDO, SEM TEXTO EXTRA OU EXPLICAÇÕES FORA DO JSON.`;

    const candidateModels = [
      "gemini-3.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.8-flash",
      "gemini-flash-latest"
    ];

    let rawText = null;
    let chosenModel = "";
    let lastError = null;

    for (const model of candidateModels) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.3,
              },
            }),
          }
        );

        if (!response.ok) {
          lastError = await response.text();
          console.warn(`Tentativa com ${model} falhou:`, lastError);
          continue;
        }

        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          rawText = text;
          chosenModel = model;
          break;
        }
      } catch (err) {
        lastError = String(err);
        console.warn(`Exceção com ${model}:`, err);
      }
    }

    if (!rawText) {
      return new Response(
        JSON.stringify({
          error: "Erro ao consultar os modelos Gemini disponíveis",
          details: lastError,
          fallback: true,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Limpar delimitadores de markdown caso o modelo tenha incluído
    let cleanJson = rawText.trim();
    if (cleanJson.startsWith("```json")) {
      cleanJson = cleanJson.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(cleanJson);

    return new Response(
      JSON.stringify({
        success: true,
        summary: parsed.summary || null,
        branches: parsed.branches || [],
        modelUsed: chosenModel,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Erro interno:", error);
    return new Response(
      JSON.stringify({ error: error.message, fallback: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
