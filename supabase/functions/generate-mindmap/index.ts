import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { model = "gemini-3.5-flash", withJsonMime = false } = await req.json().catch(() => ({}));
    const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_KEY");

    const t0 = Date.now();
    const config: any = { temperature: 0.2 };
    if (withJsonMime) config.responseMimeType = "application/json";

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Gere um JSON simples: {\"status\": \"sucesso\", \"mensagem\": \"ola\"}" }] }],
          generationConfig: config
        })
      }
    );

    const elapsed = Date.now() - t0;
    const st = res.status;
    const text = await res.text();

    return new Response(JSON.stringify({ model, elapsed, status: st, text: text.slice(0, 300) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
