import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`Ollama discovery and probe use Proxy at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => {
      window.addEventListener("message", event => {
        const data = event.data;
        if (data?.source !== "edunoza-web") return;
        const common = { source: "proxy-extension", protocol: "proxy-extension-bridge", version: 1 };
        if (data.type === "bridge-ping") {
          window.postMessage({ ...common, type: "bridge-available", extensionVersion: "test" }, location.origin);
        } else if (data.type === "bridge-request") {
          const request = data.payload;
          const body = request.body ? JSON.parse(request.body) : null;
          const valid = request.allowPrivateNetwork === true && (body === null || (body.think === false && body.options.num_predict > 16));
          window.postMessage({ ...common, type: "bridge-response", requestId: data.requestId, ok: valid,
            result: { status: 200, finalUrl: request.url, bodyText: JSON.stringify(body ? { message: { content: "Conectado" } } : { models: [{ name: "qwen3:8b" }] }) }
          }, location.origin);
        }
      });
    });
    const localRequests: string[] = [];
    page.on("request", request => { if (request.url().includes(":11434")) localRequests.push(request.url()); });
    await page.goto("/config/ai");
    await page.getByRole("combobox", { name: "Proveedor", exact: true }).selectOption("ollama");
    await page.getByRole("button", { name: "Actualizar catálogo", exact: true }).click();
    await page.getByPlaceholder("Ejemplo: llama3.2", { exact: true }).fill("qwen3:8b");
    await page.getByRole("button", { name: "Guardar y probar", exact: true }).click();
    await expect(page.getByText(/Conexión correcta con Ollama/)).toBeVisible();
    expect(localRequests).toEqual([]);
    await page.locator("summary").filter({ hasText: "Cómo conectar Ollama con Edunoza" }).click();
    const proxyHelp = page.locator(".ai-ollama-help").getByRole("link", { name: "Comprobar e instalar la extensión", exact: true });
    await expect(proxyHelp).toBeVisible();
    await expect(proxyHelp).toHaveAttribute("href", "/config/proxy");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `.impeccable/review/ollama-proxy-${width}.png`, fullPage: true });
  });
}
