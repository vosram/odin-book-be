import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createServer } from "http";
import HttpError from "./lib/httpError.ts";
import passport from "passport";
import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import authRouter from "./routes/auth.ts";
import profilesRouter from "./routes/profiles.ts";
import postRouter from "./routes/posts.ts";
import accountRouter from "./routes/account.ts";
import adminRouter from "./routes/admin.ts";

import morgan from "morgan";
import db from "./db/db.ts";
import cors from "cors";
import { AppError } from "./lib/errors.ts";
import multer from "multer";
import { status } from "http-status";
import cron from "node-cron";
import { clearExpiredRefreshTokens, clearOldUserBans } from "./lib/cronJobs.ts";
import { generateRandomUsername } from "./lib/utils.ts";
import compression from "compression";
import helmet from "helmet";
import cookieParser from "cookie-parser";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3000");

app.use(
  cors({
    origin: process.env.FE_URL!,
    optionsSuccessStatus: 200,
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));
if (process.env.NODE_ENV === "production") {
  app.use(compression());
  app.use(helmet());
}

passport.use(
  new JwtStrategy(
    {
      secretOrKey: process.env.JWT_SECRET!,
      algorithms: ["HS256"],
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    },
    async function (jwt_payload, done) {
      try {
        const user = await db.user.findUnique({
          where: {
            id: jwt_payload.sub,
          },
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            bannedUntil: true,
            profileImg: true,
            role: true,
          },
        });
        if (!user) {
          return done(null, false);
        }
        return done(null, user);
      } catch (err) {
        return done(err, false);
      }
    },
  ),
);

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_CALLBACK_URL!,
    },
    async function GoogleVerify(accessToken, refreshToken, profile, done) {
      try {
        const existingAccount = await db.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: "GOOGLE",
              providerAccountId: profile.id,
            },
          },
        });
        if (existingAccount) {
          await db.account.update({
            where: {
              id: existingAccount.id,
            },
            data: {
              accessToken: accessToken ?? "",
              refreshToken: refreshToken ?? "",
            },
          });
          const user = await db.user.findUnique({
            where: {
              id: existingAccount.userId,
            },
            select: {
              id: true,
              name: true,
              username: true,
              role: true,
              profileImg: true,
              bannedUntil: true,
              email: true,
            },
          });
          if (!user) {
            const err = new Error("Account doesn't have user linked");
            return done(err);
          } else {
            return done(null, user);
          }
        } else {
          // account doesn't exist
          const [newUser, newAccount] = await db.$transaction(async (tx) => {
            const newUser = await tx.user.create({
              data: {
                name: profile.displayName,
                username: generateRandomUsername(),
              },
              select: {
                id: true,
                name: true,
                username: true,
                role: true,
                profileImg: true,
                bannedUntil: true,
                email: true,
              },
            });

            const newAccount = await tx.account.create({
              data: {
                userId: newUser.id,
                provider: "GOOGLE",
                providerAccountId: profile.id,
              },
            });
            return [newUser, newAccount];
          });
          return done(null, newUser);
        }
      } catch (err) {
        return done(err);
      }
    },
  ),
);

app.use("/auth", authRouter);
app.use("/profiles", profilesRouter);
app.use("/posts", postRouter);
app.use("/account", accountRouter);
app.use("/admin", adminRouter);

// catch all 404 and forward to Error Handler
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new HttpError("Page does not exist.", 404));
});

// error handler
app.use(
  (
    err: HttpError | AppError,
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (err instanceof AppError) {
      console.log("error handler", err);
      res.status(err.status).json({
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      });
      return;
    }

    if (err instanceof multer.MulterError) {
      console.log("error handler", err);
      let statusCode: number;
      switch (err.code) {
        case "LIMIT_FILE_SIZE":
          statusCode = status.REQUEST_ENTITY_TOO_LARGE;
          break;
        case "LIMIT_UNEXPECTED_FILE":
          statusCode = status.UNSUPPORTED_MEDIA_TYPE;
          break;
        default:
          statusCode = 500;
      }
      res.status(statusCode).json({
        success: false,
        error: {
          code: err.code,
          message: err.message,
        },
      });
      return;
    }

    console.log("error handler", err);
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error",
      },
    });
    return;
  },
);

const server = createServer(app);
server.listen(PORT);
server.on("error", onError);
server.on("listening", onListening);
async function onError(error: Error & { syscall?: string; code?: string }) {
  if (error.syscall !== "listen") {
    throw error;
  }

  const bind = typeof PORT === "string" ? "Pipe " + PORT : "Port " + PORT;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case "EACCES":
      console.error(bind + " requires elevated privileges");
      await db.$disconnect();
      process.exit(1);
      break;
    case "EADDRINUSE":
      console.error(bind + " is already in use");
      await db.$disconnect();
      process.exit(1);
      break;
    default:
      await db.$disconnect();
      throw error;
  }
}

function onListening() {
  const addr = server.address();
  const bind = typeof addr === "string" ? "pipe " + addr : "port " + addr?.port;
  console.log("Listening on " + bind);
}

const unbanTask = cron.schedule("0 * * * *", () => {
  clearOldUserBans().then(() => {
    console.log("Unban cron job complete");
  });
  clearExpiredRefreshTokens().then(() => {
    console.log("Clear expired refresh tokens cronjob completed");
  });
});

unbanTask.start();

//graceful shutdowns
process.on("SIGHUP", async () => {
  unbanTask.stop();
  server.close((err) => {
    console.log(err);
  });
  await db.$disconnect();
  process.exit(1);
});

process.on("SIGINT", async () => {
  unbanTask.stop();
  server.close((err) => {
    console.log(err);
  });
  await db.$disconnect();
  process.exit(1);
});

process.on("SIGTERM", async () => {
  unbanTask.stop();
  server.close((err) => {
    console.log(err);
  });
  await db.$disconnect();
  process.exit(1);
});

process.on("exit", async () => {
  unbanTask.stop();
  server.close((err) => {
    console.log(err);
  });
  await db.$disconnect();
  process.exit(0);
});
