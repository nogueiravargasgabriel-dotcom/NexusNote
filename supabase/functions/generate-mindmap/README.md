# Edge Function: generate-mindmap (NexusNote)

Esta Edge Function conecta o NexusNote à API do **Google Gemini** para gerar:
1. Um resumo textual estruturado baseado nas anotações e leituras do estudante.
2. Ramos temáticos e conexões conceituais para o mapa mental interativo com a identidade visual do NexusNote.

## Como configurar e implantar no Supabase

### 1. Obtenha sua chave gratuita do Gemini
Acesse o [Google AI Studio](https://aistudio.google.com/) e crie uma API Key gratuita.

### 2. Configure o segredo no Supabase
No painel do seu projeto Supabase:
- Vá em **Project Settings** → **Edge Functions** → **Secrets**.
- Adicione o segredo:
  - **Nome:** `GEMINI_API_KEY`
  - **Valor:** `sua_chave_aqui`

Ou via Supabase CLI:
```bash
supabase secrets set GEMINI_API_KEY=sua_chave_aqui
```

### 3. Deploy da função
Via Supabase CLI:
```bash
supabase functions deploy generate-mindmap --no-verify-jwt
```
*(A flag `--no-verify-jwt` permite que os estudantes façam a chamada a partir da chave pública anônima do Supabase configurada no site).*

---

### Fallback automático
Se a Edge Function não estiver implantada ou a chave ainda não estiver cadastrada, o NexusNote utiliza automaticamente o extrator de síntese local sem travar ou interromper a experiência do estudante.
