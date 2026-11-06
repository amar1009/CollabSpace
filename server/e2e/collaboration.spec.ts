import { test, expect, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
config({ quiet: true });
const origin = "http://localhost:5173";
const password = "Browser-test-pass-2026!";
test("separate browser sessions collaborate, persist offline edits, share and restore safely", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const editorContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  const contexts = [ownerContext, editorContext, viewerContext];
  const userIds: string[] = [];
  const suffix = Date.now();
  const email = (name: string) =>
    `${name}-${suffix}@browser.collabspace.test`.toLowerCase();
  const register = async (context: BrowserContext, name: string) => {
    const res = await context.request.post(`${origin}/api/auth/register`, {
      headers: { Origin: origin },
      data: { name, email: email(name), password },
    });
    expect(res.status()).toBe(201);
    userIds.push((await res.json()).id);
  };
  try {
    const page = await ownerContext.newPage();
    await page.goto("/register");
    await page.getByLabel("Full name").fill("Alex Morgan");
    await page.getByLabel("Email address").fill(email("Owner"));
    await page.getByLabel("Password", { exact: true }).fill(password);
    const registered = page.waitForResponse((r) =>
      r.url().endsWith("/api/auth/register"),
    );
    await page.getByRole("button", { name: "Create your account" }).click();
    userIds.push((await (await registered).json()).id);
    await expect(
      page.getByRole("heading", { name: "Good to see you, Alex." }),
    ).toBeVisible();
    await page.screenshot({
      path: ".local/screenshots/dashboard.png",
      fullPage: true,
    });
    await register(editorContext, "Jamie");
    await register(viewerContext, "Taylor");
    await page
      .getByRole("button", { name: "Create document", exact: true })
      .click();
    await page.getByLabel("Document title").fill("The next big idea");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create document", exact: true })
      .click();
    const content = page.getByLabel("Document content");
    await expect(content).toBeVisible();
    await expect(page.locator(".editor-statusbar")).toContainText("Connected");
    const documentUrl = page.url();
    await content.fill("A shared place for our next chapter.");
    await expect(page.getByText("Saving changes…")).not.toBeVisible();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByLabel("Teammate email").fill(email("Jamie"));
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(page.getByText(email("Jamie"), { exact: true })).toBeVisible();
    await page.getByLabel("Teammate email").fill(email("Taylor"));
    await page.getByLabel("Permission", { exact: true }).selectOption("VIEWER");
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(
      page.getByText(email("Taylor"), { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
    const other = await editorContext.newPage();
    await other.goto(documentUrl);
    const otherContent = other.getByLabel("Document content");
    await expect(otherContent).toHaveText(
      "A shared place for our next chapter.",
    );
    await Promise.all([
      content
        .press("Control+End")
        .then(() => content.pressSequentially(" Together, we can.")),
      otherContent
        .press("Control+Home")
        .then(() => otherContent.pressSequentially("Fresh perspective: ")),
    ]);
    await expect(content).toContainText("Together, we can.");
    await expect(otherContent).toContainText("Fresh perspective:");
    const textWithoutCursors = (element: Element) => {
      const clone = element.cloneNode(true) as Element;
      clone
        .querySelectorAll(".collaboration-carets__label")
        .forEach((label) => label.remove());
      return clone.textContent;
    };
    await expect
      .poll(
        async () =>
          (await content.evaluate(textWithoutCursors)) ===
          (await otherContent.evaluate(textWithoutCursors)),
      )
      .toBe(true);
    await expect(page.locator(".editor-statusbar")).toContainText("2 online");
    await editorContext.setOffline(true);
    await otherContent.press("Control+End");
    await otherContent.pressSequentially(" Written offline.");
    await expect(otherContent).toContainText("Written offline.");
    await expect(other.locator(".editor-statusbar")).toContainText(
      "Changes retained locally",
      { timeout: 35000 },
    );
    await editorContext.setOffline(false);
    await expect(content).toContainText("Written offline.", { timeout: 15000 });
    await expect(other.getByText("Saving changes…")).not.toBeVisible();
    await other.reload();
    await expect(other.getByLabel("Document content")).toContainText(
      "Written offline.",
    );
    const view = await viewerContext.newPage();
    await view.goto(documentUrl);
    await expect(view.getByLabel("Document content")).toContainText(
      "Written offline.",
    );
    await expect(view.getByLabel("Document content")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await expect(
      view.getByRole("button", { name: "Bold", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "History", exact: true }).click();
    const savedSnapshot = page.waitForResponse(
      (response) =>
        response.url().endsWith("/versions") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save a version now" }).click();
    const snapshot = await (await savedSnapshot).json();
    const version = page.getByTestId(`version-${snapshot.id}`);
    await expect(version).toBeVisible();
    await version.click();
    await expect(page.locator(".version-preview")).toContainText(
      "Written offline.",
    );
    await page.screenshot({
      path: ".local/screenshots/editor.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Restore as a new document" })
      .click();
    await expect(page).not.toHaveURL(documentUrl);
    await expect(page.getByLabel("Document title")).toHaveValue(
      "The next big idea (restored)",
    );
    await expect(page.getByLabel("Document content")).toContainText(
      "Written offline.",
    );
    await expect(other.getByLabel("Document title")).toHaveValue(
      "The next big idea",
    );
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "The next big idea", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: ".local/screenshots/dashboard.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: ".local/screenshots/mobile.png",
      fullPage: true,
    });
    await expect(
      page.getByRole("heading", { name: "Good to see you, Alex." }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    const db = new PrismaClient();
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  }
});
