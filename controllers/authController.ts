import { type Request, type Response, type NextFunction } from "express";
import { body, matchedData } from "express-validator";
import db from "../db/db.ts";
import { validateErrors } from "../middleware/validation.ts";
import asyncHandler from "express-async-handler";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { AppError } from "../lib/errors.ts";
import passport from "passport";
import status from "http-status";
import { createRefreshToken } from "../lib/refreshTokens.ts";

// POST /api/auth/signup
export const signup_POST = [
  body("name")
    .isLength({ min: 3, max: 48 })
    .withMessage("Name must be between 3 and 48 characters."),
  body("username")
    .trim()
    .isLength({ min: 3, max: 32 })
    .withMessage("username must be between 3 and 32 characters")
    .custom(async (value) => {
      const user = await db.user.findUnique({
        where: {
          username: value,
        },
      });
      if (user) {
        throw new Error("Username taken");
      }
    })
    .custom((val) => {
      // checks if username doesn't have special characters
      // and does not start with an @ symbol
      return /^[a-zA-Z]\w+[^-_$%#@!\s&*()]$/.test(val);
    })
    .withMessage("Username should not have spaces or special characters"),
  body("email")
    .isEmail()
    .custom(async (value) => {
      const user = await db.user.findUnique({
        where: {
          email: value,
        },
      });
      if (user) {
        throw new Error("Email already registered");
      }
    }),
  body("password").isLength({ min: 8, max: 64 }),
  body("confirmPassword").custom((value, { req }) => {
    return value === req.body.password;
  }),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    // At this point, we know there are no validation errors.

    const { name, username, email, password } = matchedData(req);

    const account = await db.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "CREDENTIALS",
          providerAccountId: email,
        },
      },
    });
    if (account) {
      throw new AppError(
        status.CONFLICT,
        status[status.CONFLICT],
        "Account already exists",
      );
    }

    const hash = await bcrypt.hash(password, 10);
    const [newUser, newAccount] = await db.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          name,
          username,
          email,
          password: hash,
        },
      });

      const newAccount = await tx.account.create({
        data: {
          userId: newUser.id,
          provider: "CREDENTIALS",
          providerAccountId: newUser.email!,
        },
      });
      return [newUser, newAccount];
    });

    const refreshToken = await createRefreshToken(newUser.id);

    jwt.sign(
      { sub: newUser.id, username: newUser.username, name: newUser.name },
      process.env.JWT_SECRET!,
      {
        algorithm: "HS256",
        expiresIn: "5m",
      },
      (err, accessToken) => {
        if (err) {
          next(err);
          return;
        }
        res.cookie("refresh_token", refreshToken.token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          expires: refreshToken.expiresAt,
          path: "/api/auth",
        });
        res.status(status.CREATED).json({
          accessToken: accessToken,
        });
      },
    );
  }),
];

// POST /api/auth/signin
export const signin_POST = [
  body("email").isEmail(),
  body("password").isLength({ min: 1, max: 64 }),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    // At this point we know there is no validation errors.
    const { email, password } = matchedData(req);
    const user = await db.user.findUnique({
      where: {
        email: email,
      },
      select: {
        id: true,
        name: true,
        username: true,
        bannedUntil: true,
        password: true,
        email: true,
      },
    });

    if (!user) {
      const error = new AppError(
        status.UNAUTHORIZED,
        status[status.UNAUTHORIZED],
        "Email or password is incorrect",
      );
      res.status(error.status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }
    const passwordsMatch = await bcrypt.compare(password, user.password!);
    if (!passwordsMatch) {
      const error = new AppError(
        status.UNAUTHORIZED,
        status[status.UNAUTHORIZED],
        "Email or password is incorrect",
      );
      res.status(error.status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    const isBanned =
      user.bannedUntil != null && user.bannedUntil > new Date(Date.now());
    if (isBanned) {
      const error = new AppError(
        status.FORBIDDEN,
        status[status.FORBIDDEN],
        "You are currently banned.",
        {
          bannedUntil: user.bannedUntil,
        },
      );
      res.status(error.status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
      return;
    }

    await db.user.update({
      where: {
        id: user.id,
      },
      data: {
        lastLogin: new Date(Date.now()),
      },
    });

    const refreshToken = await createRefreshToken(user.id);

    jwt.sign(
      { sub: user.id, username: user.username, name: user.name },
      process.env.JWT_SECRET!,
      {
        algorithm: "HS256",
        expiresIn: "5m",
      },
      (err, accessToken) => {
        if (err) {
          next(err);
          return;
        }
        res.cookie("refresh_token", refreshToken.token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          expires: refreshToken.expiresAt,
          path: "/api/auth",
        });
        res.status(status.OK).json({
          success: true,
          accessToken,
        });
      },
    );
  }),
];

// POST /api/auth/refresh
export const refreshToken_POST = [
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const refreshTokenStr = req.cookies.refresh_token;
    if (!refreshTokenStr) {
      next(
        new AppError(
          status.UNAUTHORIZED,
          status[status.UNAUTHORIZED],
          "Refresh Token is missing from request cookies",
        ),
      );
      return;
    }

    const refreshToken = await db.refreshToken.findUnique({
      where: {
        token: refreshTokenStr,
      },
      include: {
        user: true,
      },
    });
    if (!refreshToken) {
      next(
        new AppError(
          status.FORBIDDEN,
          status[status.FORBIDDEN],
          "refresh token is expired",
        ),
      );
      return;
    }
    if (refreshToken.expiresAt < new Date(Date.now())) {
      next(
        new AppError(
          status.FORBIDDEN,
          status[status.FORBIDDEN],
          "refresh token is expired",
        ),
      );
      return;
    }
    if (
      refreshToken.user.bannedUntil != null &&
      refreshToken.user.bannedUntil > new Date(Date.now())
    ) {
      next(
        new AppError(
          status.FORBIDDEN,
          status[status.FORBIDDEN],
          "You are currently banned",
          {
            bannedUntil: refreshToken.user.bannedUntil,
          },
        ),
      );
      return;
    }

    await db.refreshToken.delete({
      where: {
        token: refreshToken.token,
      },
    });

    const newRefreshToken = await createRefreshToken(refreshToken.user.id);

    jwt.sign(
      {
        sub: refreshToken.user.id,
        username: refreshToken.user.username,
        name: refreshToken.user.name,
      },
      process.env.JWT_SECRET!,
      {
        algorithm: "HS256",
        expiresIn: "5m",
      },
      (err, accessToken) => {
        if (err) {
          next(err);
          return;
        }
        res.cookie("refresh_token", newRefreshToken.token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          expires: newRefreshToken.expiresAt,
          path: "/api/auth",
        });
        res.status(status.OK).json({
          success: true,
          accessToken,
        });
      },
    );
  }),
];

// POST /api/auth/logout
export const logout_POST = [
  passport.authenticate("jwt", { session: false }),
  body("allSessions").isBoolean(),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    const { allSessions } = matchedData(req);
    const refreshToken = req.cookies.refresh_token;
    if (!refreshToken) {
      next(
        new AppError(
          status.UNAUTHORIZED,
          status[status.UNAUTHORIZED],
          "You are not not authorized",
        ),
      );
      return;
    }

    if (allSessions === true) {
      // destroys all refresh tokens associated with logged in user.
      const { count } = await db.refreshToken.deleteMany({
        where: {
          userId: userId,
        },
      });

      res.cookie("refresh_token", "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        path: "/api/auth",
        maxAge: -1,
      });
      res.json({ message: `Logged out of all ${count} devices successfully` });
      return;
    }

    try {
      await db.refreshToken.delete({
        where: {
          token: refreshToken,
        },
      });
    } catch (err) {
      const error = new AppError(
        status.NOT_FOUND,
        status[status.NOT_FOUND],
        "user refresh token not found",
      );
      next(error);
      return;
    }

    res.cookie("refresh_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth",
      maxAge: -1,
    });
    res.json({ message: `logged out of current session` });
    return;
  }),
];

// GET /api/auth/check
export const check_GET = [
  passport.authenticate("jwt", { session: false }),
  (req: Request, res: Response, next: NextFunction) => {
    res.json({
      success: true,
      message: "You are authenticated",
      // @ts-ignore
      username: req.user?.username,
      //@ts-ignore
      name: req.user?.name,
      // @ts-ignore
      profileImg: req.user?.profileImg,
      isAdmin: req.user?.role && req.user.role === "ADMIN" ? true : false,
    });
  },
];

// GET /api/auth/google
export const googleLogin_GET = [
  passport.authenticate("google", { session: false, scope: ["profile"] }),
];

// GET /api/auth/google/callback
export const googleLoginCallback_GET = [
  passport.authenticate("google", { session: false }),
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const refreshToken = await createRefreshToken(req.user?.id!);
    jwt.sign(
      { sub: req.user?.id, username: req.user?.username, name: req.user?.name },
      process.env.JWT_SECRET!,
      {
        algorithm: "HS256",
        expiresIn: "5m",
      },
      (err, accessToken) => {
        if (err) {
          next(err);
          return;
        }
        // res.json({
        //   success: true,
        //   accessToken: accessToken,
        //   refreshToken: refreshToken.token,
        // });
        res.redirect(
          `${process.env.FE_URL}/oauth-success?accessToken=${accessToken}&refreshToken=${refreshToken}`,
        );
      },
    );
  }),
];
