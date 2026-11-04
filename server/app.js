import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cookieName,
  sessionOptions,
  readSession,
  issueSession,
  findAdmin,
  authenticatePassword,
  loginLimiter,
} from "./auth.js";
import {
  dashboard,
  findUsers,
  userProfile,
  activity,
  validateCountry,
  pageNumber,
  userId,
  avatarUrl,
} from "./data.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function createApp({ pool, config }) {
  const sessions = new Map();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", config.mediaOrigin],
          fontSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: config.production ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "16kb" }));
  app.use(cookieParser());
  // Serve only the template asset directory and the explicit application scripts.
  // The repository, dist sample pages, .env and the pre-existing .ssh directory are never public roots.
  app.use(
    "/assets",
    express.static(path.join(root, "src/assets"), {
      dotfiles: "deny",
      index: false,
      redirect: false,
      maxAge: "1d",
    }),
  );
  app.get("/app.js", (_req, res) =>
    res.sendFile(path.join(root, "public/app.js")),
  );
  app.get("/login.js", (_req, res) =>
    res.sendFile(path.join(root, "public/login.js")),
  );
  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  function originGuard(req, res, next) {
    if (req.get("origin") !== config.origin)
      return res.status(403).json({ error: "Origine non autorisée." });
    next();
  }
  async function requireAdmin(req, res, next) {
    try {
      const session = readSession(req, config, sessions);
      const user = session ? await findAdmin(pool, session.sub) : null;
      if (!user) {
        if (session) sessions.delete(session.jti);
        return res
          .status(401)
          .json({ error: "Session administrateur requise." });
      }
      req.admin = user;
      req.adminSession = session;
      next();
    } catch (error) {
      next(error);
    }
  }
  function csrfGuard(req, res, next) {
    if (req.get("x-csrf-token") !== req.adminSession.csrf)
      return res
        .status(403)
        .json({ error: "Rechargez la session avant de continuer." });
    next();
  }
  app.post(
    "/api/login",
    originGuard,
    loginLimiter(),
    async (req, res, next) => {
      try {
        const { email, password, otp } = req.body || {};
        if (
          typeof email !== "string" ||
          email.length > 254 ||
          typeof password !== "string" ||
          password.length < 1 ||
          password.length > 256 ||
          (otp !== undefined && typeof otp !== "string")
        )
          return res.status(400).json({ error: "Identifiants invalides." });
        const user = await authenticatePassword(
          pool,
          email.toLowerCase().trim(),
          password,
          otp,
        );
        if (!user)
          return res
            .status(401)
            .json({
              error:
                "Identifiants, code de sécurité ou accès administrateur invalides.",
            });
        res.cookie(
          cookieName,
          issueSession(user, config, sessions),
          sessionOptions(config),
        );
        res.json({ success: true });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get("/api/session", requireAdmin, (req, res) =>
    res.json({
      user: {
        ...req.admin,
        profile_photo: avatarUrl(req.admin.profile_photo, config.mediaOrigin),
      },
      csrf: req.adminSession.csrf,
    }),
  );
  app.post("/api/logout", originGuard, requireAdmin, csrfGuard, (req, res) => {
    sessions.delete(req.adminSession.jti);
    res.clearCookie(cookieName, {
      ...sessionOptions(config),
      maxAge: undefined,
    });
    res.json({ success: true });
  });
  app.get("/api/dashboard", requireAdmin, async (req, res, next) => {
    try {
      res.json(await dashboard(pool, validateCountry(req.query.country)));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/users", requireAdmin, async (req, res, next) => {
    try {
      res.json(
        await findUsers(
          pool,
          {
            search: req.query.search || "",
            country: validateCountry(req.query.country),
            page: pageNumber(req.query.page),
          },
          config.mediaOrigin,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/users/:id", requireAdmin, async (req, res, next) => {
    try {
      res.json(
        await userProfile(pool, userId(req.params.id), config.mediaOrigin),
      );
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/users/:id/activity", requireAdmin, async (req, res, next) => {
    try {
      res.json(
        await activity(
          pool,
          userId(req.params.id),
          req.query.kind || "transactions",
          pageNumber(req.query.page),
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  app.get("/login", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(root, "src/backoffice/login.html"));
  });
  app.get(
    ["/", "/dashboard", "/users", "/users/:id"],
    async (req, res, next) => {
      try {
        const session = readSession(req, config, sessions);
        if (!session || !(await findAdmin(pool, session.sub)))
          return res.redirect("/login");
        res.set("Cache-Control", "no-store");
        res.sendFile(path.join(root, "src/backoffice/index.html"));
      } catch (error) {
        next(error);
      }
    },
  );
  app.use((_req, res) =>
    res.status(404).json({ error: "Page ou service introuvable." }),
  );
  app.use((error, _req, res, _next) => {
    const status =
      error.status ||
      ([
        "42P01",
        "42703",
        "42501",
        "28P01",
        "ECONNREFUSED",
        "ETIMEDOUT",
        "57014",
        "22P02",
      ].includes(error.code)
        ? 503
        : 500);
    console.error("[request]", error.code || "failed");
    res
      .status(status)
      .json({
        error:
          status < 500
            ? error.type === "entity.parse.failed"
              ? "Requête JSON invalide."
              : error.message
            : "Données indisponibles. Vérifiez la connexion PostgreSQL, les droits de lecture et le schéma partagé. Aucun montant de remplacement n’est affiché.",
      });
  });
  return app;
}
