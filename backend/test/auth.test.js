const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const express = require("express");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aims-auth-"));
process.env.DATA_FILE = path.join(tempDir, "stock.json");
process.env.OWNER_USERNAME = "test-owner";
process.env.OWNER_PASSWORD = "test-owner-password";
process.env.JWT_SECRET = "test-jwt-signing-secret-with-at-least-32-bytes";

const auth = require("../src/auth");
const routes = require("../src/routes");

async function main() {
  assert.strictEqual(auth.isConfigured(), true);
  assert.strictEqual(auth.verifyOwnerCredentials("test-owner", "test-owner-password"), true);
  assert.strictEqual(auth.verifyOwnerCredentials("wrong-owner", "test-owner-password"), false);
  assert.strictEqual(auth.verifyOwnerCredentials("test-owner", "wrong-password"), false);
  assert.strictEqual(auth.verifyOwnerCredentials("", "test-owner-password"), false);

  const token = auth.createOwnerToken(1000);
  assert.strictEqual(auth.verifyOwnerToken(token, 1001), true);
  assert.strictEqual(auth.verifyOwnerToken(token, 1000 + auth.TOKEN_LIFETIME_SECONDS), false);
  assert.strictEqual(auth.verifyOwnerToken(`${token.slice(0, -1)}x`, 1001), false);
  assert.strictEqual(auth.verifyOwnerToken("not.a.jwt", 1001), false);

  const app = express();
  app.use(express.json());
  app.use("/api", routes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  try {
    const savedOwnerPassword = process.env.OWNER_PASSWORD;
    const savedOwnerUsername = process.env.OWNER_USERNAME;
    const savedJwtSecret = process.env.JWT_SECRET;
    delete process.env.OWNER_USERNAME;
    const missingUsernameConfigLogin = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test-owner", password: "test-owner-password" }),
    });
    assert.strictEqual(missingUsernameConfigLogin.status, 503, "login must fail closed without owner username");
    process.env.OWNER_USERNAME = savedOwnerUsername;
    delete process.env.OWNER_PASSWORD;
    const unconfiguredLogin = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test-owner", password: "test-owner-password" }),
    });
    assert.strictEqual(unconfiguredLogin.status, 503, "login must fail closed without owner credentials");
    process.env.OWNER_PASSWORD = savedOwnerPassword;
    process.env.JWT_SECRET = "too-short";
    const unconfiguredAdjustment = await fetch(`${baseUrl}/stock/totals/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: "Oreo biscuit", delta: 1 }),
    });
    assert.strictEqual(unconfiguredAdjustment.status, 503, "mutations must fail closed with a weak JWT secret");
    process.env.JWT_SECRET = savedJwtSecret;

    const anonymousAdjustment = await fetch(`${baseUrl}/stock/totals/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: "Oreo biscuit", delta: -1 }),
    });
    assert.strictEqual(anonymousAdjustment.status, 401, "manual adjustment must require a JWT");

    const anonymousReset = await fetch(`${baseUrl}/stock/totals/reset`, { method: "POST" });
    assert.strictEqual(anonymousReset.status, 401, "manual reset must require a JWT");

    const anonymousInvoice = await fetch(`${baseUrl}/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });
    assert.strictEqual(anonymousInvoice.status, 401, "invoice stock receipt must require a JWT");

    const failedLogin = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test-owner", password: "wrong-password" }),
    });
    assert.strictEqual(failedLogin.status, 401, "incorrect owner password must be rejected");

    const wrongUsernameLogin = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "other-owner", password: "test-owner-password" }),
    });
    assert.strictEqual(wrongUsernameLogin.status, 401, "incorrect owner username must be rejected");

    const missingUsernameLogin = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-owner-password" }),
    });
    assert.strictEqual(missingUsernameLogin.status, 401, "username must be required for login");

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test-owner", password: "test-owner-password" }),
    });
    assert.strictEqual(login.status, 200);
    const { token: ownerToken } = await login.json();
    assert.strictEqual(typeof ownerToken, "string");

    const adjustment = await fetch(`${baseUrl}/stock/totals/adjust`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ sku: "Oreo biscuit", delta: 1 }),
    });
    assert.strictEqual(adjustment.status, 200, "valid owner JWT should allow manual adjustment");
    assert.strictEqual((await adjustment.json()).total, 1);

    const reset = await fetch(`${baseUrl}/stock/totals/reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.strictEqual(reset.status, 200, "valid owner JWT should allow reset");

    console.log("Authentication tests passed.");
  } finally {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
