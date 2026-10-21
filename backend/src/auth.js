const crypto = require("crypto");

const TOKEN_LIFETIME_SECONDS = 60 * 60;

function isConfigured() {
  return Boolean(
    process.env.OWNER_USERNAME &&
    process.env.OWNER_PASSWORD &&
      process.env.JWT_SECRET &&
      Buffer.byteLength(process.env.JWT_SECRET, "utf8") >= 32
  );
}

function matchesSecret(submitted, configured) {
  const submittedHash = crypto.createHash("sha256").update(submitted).digest();
  const configuredHash = crypto.createHash("sha256").update(configured).digest();
  return crypto.timingSafeEqual(submittedHash, configuredHash);
}

function verifyOwnerCredentials(username, password) {
  if (
    typeof username !== "string" ||
    !username.trim() ||
    username.length > 256 ||
    typeof password !== "string" ||
    password.length > 1024
  ) {
    return false;
  }

  const configuredUsername = process.env.OWNER_USERNAME;
  const configuredPassword = process.env.OWNER_PASSWORD;
  if (!configuredUsername || !configuredPassword) return false;

  const usernameMatches = matchesSecret(username, configuredUsername);
  const passwordMatches = matchesSecret(password, configuredPassword);
  return usernameMatches && passwordMatches;
}

function createOwnerToken(now = Math.floor(Date.now() / 1000)) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "owner", iat: now, exp: now + TOKEN_LIFETIME_SECONDS })
  ).toString("base64url");
  const unsignedToken = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(unsignedToken)
    .digest("base64url");

  return `${unsignedToken}.${signature}`;
}

function verifyOwnerToken(token, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  try {
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (header.alg !== "HS256" || header.typ !== "JWT") return false;
    if (payload.sub !== "owner" || !Number.isInteger(payload.exp) || payload.exp <= now) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.JWT_SECRET)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();
    const providedSignature = Buffer.from(encodedSignature, "base64url");
    return (
      expectedSignature.length === providedSignature.length &&
      crypto.timingSafeEqual(expectedSignature, providedSignature)
    );
  } catch {
    return false;
  }
}

function requireOwner(req, res, next) {
  if (!isConfigured()) {
    return res.status(503).json({
      error: "Owner authentication is not configured. Set OWNER_USERNAME, OWNER_PASSWORD, and a JWT_SECRET of at least 32 characters.",
    });
  }

  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer ([^\s]+)$/i);
  if (!match || !verifyOwnerToken(match[1])) {
    res.set("WWW-Authenticate", 'Bearer realm="owner"');
    return res.status(401).json({ error: "Owner authentication required" });
  }

  req.owner = { id: "owner" };
  return next();
}

module.exports = {
  TOKEN_LIFETIME_SECONDS,
  createOwnerToken,
  isConfigured,
  requireOwner,
  verifyOwnerCredentials,
  verifyOwnerToken,
};
