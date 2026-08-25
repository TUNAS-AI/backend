export const swaggerTokenHandoffScript = `
(() => {
  const tokenKey = "hijau.swagger.bearer";

  const authorizeSwagger = () => {
    const token = sessionStorage.getItem(tokenKey);
    if (!token || !window.ui) return false;

    window.ui.preauthorizeApiKey("bearerAuth", token);
    sessionStorage.removeItem(tokenKey);
    return true;
  };

  window.addEventListener("load", () => {
    const authorizationTimer = window.setInterval(() => {
      if (authorizeSwagger()) window.clearInterval(authorizationTimer);
    }, 50);

    const link = document.createElement("a");
    link.href = "/api/auth/google/swagger";
    link.textContent = "Sign in with Google";
    link.style.cssText = "display:inline-block;margin:16px;font:600 14px sans-serif";
    document.body.prepend(link);
  });
})();
`;
