import type { Request, Response, NextFunction } from "express";
import passport from "passport";
import asyncHandler from "express-async-handler";
import db from "../db/db.ts";
import { AppError } from "../lib/errors.ts";
import { body, matchedData } from "express-validator";
import { validateErrors } from "../middleware/validation.ts";
import { upload } from "../middleware/multer.ts";
import cloudinary from "../lib/cloudinaryUploader.ts";
import fs from "node:fs/promises";
import { Prisma } from "../generated/prisma/client";
import bcrypt from "bcryptjs";
import status from "http-status";
import { createIdBatchesForDeletion } from "../lib/utils.ts";

// GET /account/user
export const account_GET = [
  passport.authenticate("jwt", { session: false }),
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = await db.user.findUnique({
      where: {
        id: req.user?.id,
      },
      select: {
        id: true,
        name: true,
        username: true,
        bio: true,
        profileImg: true,
        profileImgId: true,
        account: {
          select: {
            provider: true,
          },
        },
      },
    });

    if (!user) {
      throw new AppError(404, "NOT_FOUND", "User Not found");
    }
    const hasCredentialsAccount = user.account.some(
      (account) => account.provider === "CREDENTIALS",
    );
    res.json({
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        bio: user.bio,
        profileImg: user.profileImgId
          ? cloudinary.url(user.profileImgId, {
              transformation: [
                {
                  width: 100,
                  crop: "scale",
                },
                {
                  quality: "auto",
                  fetch_format: "jpg",
                },
              ],
            })
          : user.profileImg,
      },
      hasCredentialsAccount: hasCredentialsAccount,
    });
  }),
];

// PUT /account/user
export const editAccountInfo_PUT = [
  passport.authenticate("jwt", { session: false }),
  upload.single("profileImg"),
  body("name").isLength({ max: 48 }),
  body("bio").isLength({ max: 512 }).optional(),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    const name = String(data.name);
    const bio = String(data.bio);

    // Get current user
    const currentUser = await db.user.findUnique({
      where: {
        id: req.user?.id,
      },
      select: {
        id: true,
        profileImg: true,
        profileImgId: true,
      },
    });
    if (!currentUser) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    // Upload image if there;
    if (req.file) {
      const filePath = req.file.path;
      const uploadResult = await cloudinary.uploader.upload(filePath, {
        use_filename: true,
        asset_folder: "odin-book/avatars",
      });

      if (currentUser.profileImg) {
        // TODO: check if profileImgId exists as this might throw since
        // users table has profileImgId as nullable.
        await cloudinary.uploader.destroy(currentUser.profileImgId!);
      }
      await db.user.update({
        where: {
          id: currentUser.id,
        },
        data: {
          name: name ?? Prisma.skip,
          bio: bio ?? "",
          profileImg: uploadResult.secure_url,
          profileImgId: uploadResult.public_id,
        },
      });
      await fs.rm(req.file.path);
      res.json({ message: "User profile updated" });
      return;
    }

    // issue update without profileImg
    await db.user.update({
      where: {
        id: currentUser.id,
      },
      data: {
        name: name ?? Prisma.skip,
        bio: bio ?? "",
      },
    });
    res.json({ message: "User profile updated without profile image" });
  }),
];

// PUT /account/password
export const updatePassword_PUT = [
  passport.authenticate("jwt", { session: false }),
  body("oldPassword").notEmpty(),
  body("newPassword")
    .isLength({ min: 8, max: 48 })
    .withMessage("New password must be between 8 and 48 characters"),
  body("confirmNewPassword")
    .custom((val, { req }) => {
      return val === req.body.newPassword;
    })
    .withMessage("New password and confirm new passwords don't match"),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    const oldPassword = String(data.oldPassword);
    const newPassword = String(data.newPassword);

    const currentUser = await db.user.findUnique({
      where: {
        id: req.user?.id,
      },
      select: {
        id: true,
        password: true,
        account: {
          select: {
            provider: true,
          },
        },
      },
    });

    if (!currentUser) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    if (currentUser.account.length === 0) {
      throw new AppError(
        status.CONFLICT,
        status[status.CONFLICT],
        "No account has been found for this user",
      );
    }

    const hasCredentialsAccount = currentUser.account.some(
      (account) => account.provider === "CREDENTIALS",
    );
    if (!hasCredentialsAccount) {
      throw new AppError(
        status.CONFLICT,
        status[status.CONFLICT],
        "User doesn't use passwords",
      );
    }

    const passwordValid = await bcrypt.compare(
      oldPassword,
      currentUser.password!,
    );

    if (!passwordValid) {
      throw new AppError(403, "FORBIDDEN", "Password is not valid");
    }
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await db.user.update({
      where: {
        id: currentUser.id,
      },
      data: {
        password: newPasswordHash,
      },
    });
    res.json({ message: "Password updated" });
    return;
  }),
];

// PUT /account/username
export const updateUsername_PUT = [
  passport.authenticate("jwt", { session: false }),
  body("newUsername")
    .trim()
    .isLength({ min: 3, max: 32 })
    .custom((val) => {
      // checks if username doesn't have special characters
      // and does not start with an @ symbol
      return /^[a-zA-Z]\w+[^-_$%#@!\s&*()]$/.test(val);
    })
    .withMessage("Username should not have spaces or special characters"),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    const newUsername = String(data.newUsername);
    const currentUser = await db.user.findUnique({
      where: {
        id: req.user?.id,
      },
      select: {
        id: true,
        username: true,
      },
    });
    if (!currentUser) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }
    const isUsernameTaken = await db.user.findUnique({
      where: {
        username: newUsername,
      },
      select: {
        id: true,
        username: true,
      },
    });
    if (isUsernameTaken) {
      throw new AppError(403, "FORBIDDEN", "Username already taken");
      return;
    }
    await db.user.update({
      where: {
        id: currentUser.id,
      },
      data: {
        username: newUsername,
      },
    });

    res.json({ message: "Username successfully updated" });
  }),
];

// DELETE /account/user
export const deleteAccount_DELETE = [
  passport.authenticate("jwt", { session: false }),
  body("confirm")
    .custom((val) => {
      return val === "delete my account";
    })
    .withMessage("Confirmation phrase not valid"),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const currentUser = await db.user.findUnique({
      where: {
        id: req.user?.id,
      },
      select: {
        id: true,
        username: true,
        password: true,
        profileImgId: true,
      },
    });
    if (!currentUser) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    const allPosts = await db.post.findMany({
      where: {
        authorId: currentUser.id,
      },
      select: {
        id: true,
        imageId: true,
      },
    });

    // delete post images
    const imgIds: string[] = [];
    allPosts.forEach((post) => {
      if (post.imageId) {
        imgIds.push(post.imageId);
      }
    });
    const imgIdBatches = createIdBatchesForDeletion(imgIds, 100);
    for (const batch of imgIdBatches) {
      const result = await cloudinary.api.delete_resources(batch);
    }

    // delete profile avatar
    if (currentUser.profileImgId) {
      const result = await cloudinary.uploader.destroy(
        currentUser.profileImgId,
      );
    }

    const deletedUser = await db.user.delete({
      where: {
        id: req.user?.id,
      },
      select: {
        id: true,
        username: true,
      },
    });

    res.json({
      message: "Account successfully deleted",
      username: deletedUser.username,
      id: deletedUser.id,
    });
  }),
];
