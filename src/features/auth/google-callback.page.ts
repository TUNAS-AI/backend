export function googleCallbackPage(): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hijau AI sign-in</title></head>
  <body>
    <main>
      <h1>Google sign-in complete</h1>
      <p id="status">Preparing Swagger UI…</p>
      <button id="open-swagger" type="button" hidden>Open Swagger UI</button>
      <pre id="token" hidden></pre>
      <button id="copy" type="button" hidden>Copy access token</button>
    </main>
    <script>
      const token = new URLSearchParams(window.location.hash.slice(1)).get("access_token");
      const status = document.getElementById("status");
      const openSwagger = document.getElementById("open-swagger");
      const tokenElement = document.getElementById("token");
      const copyButton = document.getElementById("copy");

      history.replaceState(null, "", window.location.pathname);
      if (!token) {
        status.textContent = "No access token was returned. Check the Supabase redirect URL and try again.";
      } else {
        sessionStorage.setItem("hijau.swagger.bearer", token);
        status.textContent = "Your Swagger session is ready.";
        openSwagger.hidden = false;
        tokenElement.textContent = token;
        tokenElement.hidden = false;
        copyButton.hidden = false;
        openSwagger.addEventListener("click", () => window.location.assign("/api-docs"));
        copyButton.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(token);
            copyButton.textContent = "Copied";
          } catch {
            copyButton.textContent = "Copy manually";
          }
        });
      }
    </script>
  </body>
</html>`;
}

