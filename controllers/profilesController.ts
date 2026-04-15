import { validateErrors } from "../middleware/validation.ts";
import asyncHandler from "express-async-handler";
import { matchedData, param, query } from "express-validator";
import passport from "passport";
import { type Request, type Response, type NextFunction } from "express";
import db from "../db/db.ts";
import { AppError } from "../lib/errors.ts";
import cloudinary from "../lib/cloudinaryUploader.ts";
import { Prisma } from "../generated/prisma/client.ts";

// GET /profiles
export const profiles_GET = [
  passport.authenticate("jwt", { session: false }),
  query("page")
    .isInt({ min: 1 })
    .withMessage("page should be a positive number"),
  query("search").isLength({ max: 32 }).optional(),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const LIMIT = 25;
    const data = matchedData(req);
    let page = parseInt(data.page);
    const search = String(data.search || "");

    const totalUsers = await db.user.count({
      where: search ? { username: search } : {},
    });
    const totalPages = Math.ceil(totalUsers === 0 ? 1 : totalUsers / LIMIT);
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * LIMIT;

    const whereOptions: Prisma.UserWhereInput = {};

    if (search) {
      whereOptions.username = { contains: search };
    }
    const allUsers = await db.user.findMany({
      where: whereOptions,
      skip: offset,
      take: LIMIT,
      select: {
        id: true,
        name: true,
        username: true,
        bio: true,
        profileImg: true,
        profileImgId: true,
        _count: {
          select: {
            followers: true,
          },
        },
        followers: {
          select: {
            followerId: true,
          },
        },
      },
      orderBy: [
        {
          followers: {
            _count: "desc",
          },
        },
        {
          name: "asc",
        },
      ],
    });
    // TODO: check if logged in user follows them or not
    const finalUsers = allUsers.map((user) => {
      return {
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
        _count: {
          followedBy: user._count.followers,
        },
        areFollowing: user.followers.some(
          (user) => user.followerId === req.user?.id,
        ),
      };
    });

    res.json({
      success: true,
      users: finalUsers,
      currentPage: page,
      totalPages: totalPages,
    });
    return;
  }),
];

// GET /profiles/:username
export const profile_GET = [
  passport.authenticate("jwt", { session: false }),
  param("username").isLength({ max: 32 }).withMessage("not a valid username"),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    const userProfile = await db.user.findUnique({
      where: {
        username: data.username,
      },
      select: {
        id: true,
        name: true,
        username: true,
        bannedUntil: true,
        bio: true,
        profileImg: true,
        profileImgId: true,
        _count: {
          select: {
            posts: true,
            followers: true,
            following: true,
          },
        },
        followers: {
          select: {
            followerId: true,
          },
        },
      },
    });

    if (!userProfile) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }
    const finalProfile = {
      id: userProfile.id,
      name: userProfile.name,
      username: userProfile.username,
      bannedUntil: userProfile.bannedUntil,
      bio: userProfile.bio,
      profileImg: userProfile.profileImgId
        ? cloudinary.url(userProfile.profileImgId, {
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
        : userProfile.profileImg,
      _count: {
        posts: userProfile._count.posts,
        followedBy: userProfile._count.followers,
        following: userProfile._count.following,
      },
      areFollowing: userProfile.followers.some(
        (user) => user.followerId === req.user?.id,
      ),
    };

    res.json({
      success: true,
      user: finalProfile,
    });
  }),
];

// POST /profiles/:username/follow
export const profileFollow_POST = [
  passport.authenticate("jwt", { session: false }),
  param("username").isLength({ max: 32 }).withMessage("not a valid username"),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);

    const user = await db.user.findUnique({
      where: {
        username: data.username,
      },
      select: {
        id: true,
        username: true,
      },
    });
    if (!user) {
      const error = new AppError(404, "NOT_FOUND", "User not found");
      res.status(error.status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }
    const userAlreadyFollows = await db.userFollows.findUnique({
      where: {
        followerId_followingId: {
          followerId: req.user?.id!,
          followingId: user.id,
        },
      },
    });
    if (!userAlreadyFollows) {
      await db.userFollows.create({
        data: {
          followerId: req.user?.id!,
          followingId: user.id,
        },
      });
    }

    // send response
    res.json({
      success: true,
      message: `successfully following ${user.username}`,
    });
  }),
];

// DELETE /profiles/:username/follow
export const profileUnfollow_DELETE = [
  passport.authenticate("jwt", { session: false }),
  param("username").isLength({ max: 32 }).withMessage("not a valid username"),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);

    const user = await db.user.findUnique({
      where: {
        username: data.username,
      },
      select: {
        id: true,
        username: true,
      },
    });
    if (!user) {
      const error = new AppError(404, "NOT_FOUND", "User not found");
      res.status(error.status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    await db.userFollows.deleteMany({
      where: {
        followerId: req.user?.id!,
        followingId: user.id,
      },
    });
    res.json({
      success: true,
      message: `Successfully unfollowed ${user.username}`,
    });
  }),
];

// GET /profiles/:username/following
export const profileFollowing_GET = [
  passport.authenticate("jwt", { session: false }),
  param("username")
    .isLength({ min: 3, max: 32 })
    .withMessage("Not a valid username"),
  query("page").isInt({ gt: 0 }).withMessage("must be positive integer"),
  query("limit")
    .isInt({ gt: 10, lt: 50 })
    .withMessage("Limit should be between 10 and 50"),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    const username = String(data.username);
    let page = parseInt(data.page);
    const LIMIT = parseInt(data.limit);

    // get list of users that :username is following
    const userSpotlighted = await db.user.findUnique({
      where: {
        username: username,
      },
      select: {
        id: true,
        name: true,
        username: true,
      },
    });

    if (!userSpotlighted) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }
    const totalUsers = await db.user.count({
      where: {
        followers: {
          some: {
            followerId: userSpotlighted.id,
          },
        },
      },
    });
    const totalPages = Math.ceil(totalUsers === 0 ? 1 : totalUsers / LIMIT);
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * LIMIT;

    const userList = await db.user.findMany({
      where: {
        followers: {
          some: {
            followerId: userSpotlighted.id,
          },
        },
      },
      select: {
        id: true,
        name: true,
        username: true,
        bio: true,
        profileImg: true,
        profileImgId: true,
        _count: {
          select: {
            followers: true,
            following: true,
          },
        },
        followers: {
          select: {
            followerId: true,
          },
        },
      },
      orderBy: [
        {
          followers: {
            _count: "desc",
          },
        },
        {
          id: "asc",
        },
      ],
      skip: offset,
      take: LIMIT,
    });

    // transform users to see if req.user is also following the listed users.
    const finalList = userList.map((user) => ({
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
      _count: {
        followedBy: user._count.followers,
        following: user._count.following,
      },
      areFollowing: user.followers.some(
        (followedByUser) => followedByUser.followerId === req.user?.id,
      ),
    }));

    res.json({
      users: finalList,
      currentPage: page,
      totalPages: totalPages,
    });
  }),
];

// GET /profiles/:username/followers
export const profileFollowers_GET = [
  passport.authenticate("jwt", { session: false }),
  param("username")
    .isLength({ min: 3, max: 32 })
    .withMessage("Not a valid username"),
  query("page").isInt({ gt: 0 }).withMessage("must be positive integer"),
  query("limit")
    .isInt({ gt: 10, lt: 50 })
    .withMessage("Limit should be between 10 and 50"),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    const username = String(data.username);
    let page = parseInt(data.page);
    const LIMIT = parseInt(data.limit);

    // get list of users that are following :username
    const userSpotlighted = await db.user.findUnique({
      where: {
        username: username,
      },
      select: {
        id: true,
        name: true,
        username: true,
      },
    });

    if (!userSpotlighted) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }
    const totalUsers = await db.user.count({
      where: {
        following: {
          some: {
            followingId: userSpotlighted.id,
          },
        },
      },
    });
    const totalPages = Math.ceil(totalUsers === 0 ? 1 : totalUsers / LIMIT);
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * LIMIT;

    const userList = await db.user.findMany({
      where: {
        following: {
          some: {
            followingId: userSpotlighted.id,
          },
        },
      },
      select: {
        id: true,
        name: true,
        username: true,
        bio: true,
        profileImg: true,
        profileImgId: true,
        _count: {
          select: {
            followers: true,
            following: true,
          },
        },
        followers: {
          select: {
            followerId: true,
          },
        },
      },
      orderBy: [
        {
          followers: {
            _count: "desc",
          },
        },
        {
          id: "asc",
        },
      ],
      skip: offset,
      take: LIMIT,
    });

    // transform users to see if req.user is also following the listed users.
    const finalList = userList.map((user) => ({
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
      _count: {
        followedBy: user._count.followers,
        following: user._count.following,
      },
      areFollowing: user.followers.some(
        (followedByUser) => followedByUser.followerId === req.user?.id,
      ),
    }));

    res.json({
      users: finalList,
      currentPage: page,
      totalPages: totalPages,
    });
  }),
];
