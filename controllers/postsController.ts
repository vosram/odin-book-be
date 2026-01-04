import { type Request, type Response, type NextFunction } from "express";
import passport from "passport";
import { body, matchedData, param, query } from "express-validator";
import { validateErrors } from "../middleware/validation.ts";
import asyncHandler from "express-async-handler";
import db from "../db/db.ts";
import { AppError } from "../lib/errors.ts";
import { upload } from "../middleware/multer.ts";
import cloudinary from "../lib/cloudinaryUploader.ts";
import fs from "node:fs/promises";
import { status } from "http-status";

// GET /posts
export const getPosts_GET = [
  passport.authenticate("jwt", { session: false }),
  query("feed")
    .custom((value) => {
      return ["personal", "explore", "user", "liked"].includes(value);
    })
    .withMessage("feed must be: personal, explore, user, or liked"),
  query("sort")
    .custom((value) => {
      return ["popular", "latest", "oldest"].includes(value);
    })
    .withMessage("sort must be: popular, latest, or oldest"),
  query("username")
    .custom((value, { req }) => {
      // this ensures we know that username is set if feed=user
      if (req.query?.feed && req.query.feed === "user" && !value) {
        return false;
      } else {
        return true;
      }
    })
    .withMessage("Query param username must be set if feed is set to user"),
  query("page").isInt({ gt: 0 }),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    let page: number = parseInt(data.page);
    const feed = String(data.feed);
    const sort = String(data.sort);
    const LIMIT = 15;
    const { username } = data;
    // handle logic for user posts
    if (feed === "user") {
      const user = await db.user.findUnique({
        where: {
          username: username,
        },
        select: {
          id: true,
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
      const totalPosts = await db.post.count({
        where: {
          authorId: user.id,
        },
      });
      const totalPages = Math.ceil(totalPosts === 0 ? 1 : totalPosts / LIMIT);
      if (page > totalPages) page = totalPages;

      const offset = (page - 1) * LIMIT;

      const orderByValue: {
        likes?: { _count: "asc" | "desc" };
        createdAt?: "asc" | "desc";
      } = {};
      if (sort === "popular") {
        orderByValue.likes = { _count: "desc" };
      } else if (sort === "latest") {
        orderByValue.createdAt = "desc";
      } else if (sort === "oldest") {
        orderByValue.createdAt = "asc";
      } else {
        orderByValue.likes = { _count: "desc" };
      }

      const posts = await db.post.findMany({
        where: {
          authorId: user.id,
        },
        skip: offset,
        take: LIMIT,
        select: {
          id: true,
          caption: true,
          imageUrl: true,
          imageId: true,
          createdAt: true,
          updatedAt: true,
          imageWidth: true,
          imageHeight: true,
          author: {
            select: {
              id: true,
              name: true,
              username: true,
              profileImg: true,
              profileImgId: true,
            },
          },
          _count: {
            select: {
              likes: true,
              comments: true,
            },
          },
          likes: {
            where: {
              userId: req.user?.id,
            },
            select: {
              userId: true,
            },
          },
        },
        orderBy: [orderByValue, { id: "asc" }],
      });

      const finalPost = posts.map((post) => {
        return {
          id: post.id,
          _count: {
            userLikes: post._count.likes,
            comments: post._count.comments,
          },
          caption: post.caption,
          imageUrl: post.imageId
            ? cloudinary.url(post.imageId, {
                transformation: [
                  {
                    width: 1000,
                    crop: "scale",
                  },
                  {
                    fetch_format: "jpg",
                    quality: "auto",
                  },
                ],
              })
            : post.imageUrl,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
          imageWidth: post.imageWidth,
          imageHeight: post.imageHeight,
          author: {
            id: post.author.id,
            name: post.author.name,
            username: post.author.username,
            profileImg: post.author.profileImgId
              ? cloudinary.url(post.author.profileImgId, {
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
              : post.author.profileImg,
          },
          likedByUser: post.likes.length > 0,
        };
      });
      res.json({
        posts: finalPost,
        currentPage: page,
        totalPages: totalPages,
      });
      return;
    }

    // handle logic for liked posts
    if (feed === "liked") {
      const totalPosts = await db.post.count({
        where: {
          likes: {
            some: {
              userId: req.user?.id,
            },
          },
        },
      });
      const totalPages = Math.ceil(totalPosts === 0 ? 1 : totalPosts / LIMIT);
      if (page > totalPages) page = totalPages;

      const offset = (page - 1) * LIMIT;

      const orderByValue: {
        likes?: { _count: "asc" | "desc" };
        createdAt?: "asc" | "desc";
      } = {};
      if (sort === "popular") {
        orderByValue.likes = { _count: "desc" };
      } else if (sort === "latest") {
        orderByValue.createdAt = "desc";
      } else if (sort === "oldest") {
        orderByValue.createdAt = "asc";
      } else {
        orderByValue.likes = { _count: "desc" };
      }

      const posts = await db.post.findMany({
        where: {
          likes: {
            some: {
              userId: req.user?.id,
            },
          },
        },
        skip: offset,
        take: LIMIT,
        select: {
          id: true,
          caption: true,
          imageId: true,
          imageUrl: true,
          createdAt: true,
          updatedAt: true,
          imageWidth: true,
          imageHeight: true,
          author: {
            select: {
              id: true,
              name: true,
              username: true,
              profileImg: true,
              profileImgId: true,
            },
          },
          _count: {
            select: {
              likes: true,
              comments: true,
            },
          },
          likes: {
            where: {
              userId: req.user?.id,
            },
            select: {
              userId: true,
            },
          },
        },
        orderBy: [orderByValue, { id: "asc" }],
      });

      const finalPosts = posts.map((post) => {
        return {
          id: post.id,
          _count: {
            userLikes: post._count.likes,
            comments: post._count.comments,
          },
          author: {
            id: post.author.id,
            name: post.author.name,
            username: post.author.username,
            profileImg: post.author.profileImgId
              ? cloudinary.url(post.author.profileImgId, {
                  transformation: [
                    {
                      width: 100,
                      crop: "auto",
                    },
                    {
                      quality: "auto",
                      fetch_format: "jpg",
                    },
                  ],
                })
              : post.author.profileImg,
          },
          caption: post.caption,
          imageUrl: post.imageId
            ? cloudinary.url(post.imageId, {
                transformation: [
                  {
                    width: 1000,
                    crop: "scale",
                  },
                  {
                    quality: "auto",
                    fetch_format: "jpg",
                  },
                ],
              })
            : post.imageUrl,
          imageWidth: post.imageWidth,
          imageHeight: post.imageHeight,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
          likedByUser: post.likes.length > 0,
        };
      });
      res.json({
        posts: finalPosts,
        currentPage: page,
        totalPages: totalPages,
      });
      return;
    }
    // handle logic for explore posts
    if (feed === "explore") {
      const totalPosts = await db.post.count();
      const totalPages = Math.ceil(totalPosts === 0 ? 1 : totalPosts / LIMIT);
      if (page > totalPages) page = totalPages;

      const offset = (page - 1) * LIMIT;

      const orderByValue: {
        likes?: { _count: "asc" | "desc" };
        createdAt?: "asc" | "desc";
      } = {};
      if (sort === "popular") {
        orderByValue.likes = { _count: "desc" };
      } else if (sort === "latest") {
        orderByValue.createdAt = "desc";
      } else if (sort === "oldest") {
        orderByValue.createdAt = "asc";
      } else {
        orderByValue.likes = { _count: "desc" };
      }

      const posts = await db.post.findMany({
        skip: offset,
        take: LIMIT,
        select: {
          id: true,
          caption: true,
          imageId: true,
          imageUrl: true,
          createdAt: true,
          updatedAt: true,
          imageWidth: true,
          imageHeight: true,
          author: {
            select: {
              id: true,
              name: true,
              username: true,
              profileImg: true,
              profileImgId: true,
            },
          },
          _count: {
            select: {
              likes: true,
              comments: true,
            },
          },
          likes: {
            where: {
              userId: req.user?.id,
            },
            select: {
              userId: true,
            },
          },
        },
        orderBy: [orderByValue, { id: "asc" }],
      });

      const finalPosts = posts.map((post) => {
        return {
          id: post.id,
          caption: post.caption,
          imageUrl: post.imageId
            ? cloudinary.url(post.imageId, {
                transformation: [
                  {
                    width: 1000,
                    crop: "scale",
                  },
                  {
                    quality: "auto",
                    fetch_format: "jpg",
                  },
                ],
              })
            : post.imageUrl,
          imageWidth: post.imageWidth,
          imageHeight: post.imageHeight,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
          author: {
            id: post.author.id,
            username: post.author.username,
            name: post.author.name,
            profileImg: post.author.profileImgId
              ? cloudinary.url(post.author.profileImgId, {
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
              : post.author.profileImg,
          },
          _count: {
            userLikes: post._count.likes,
            comments: post._count.comments,
          },
          likedByUser: post.likes.length > 0,
          userIsAuthor: req.user?.id === post.author.id,
        };
      });
      res.json({
        posts: finalPosts,
        currentPage: page,
        totalPages: totalPages,
      });
      return;
    }
    // handle logic for personal feed posts
    if (feed === "personal") {
      const totalPosts = await db.post.count({
        where: {
          OR: [
            {
              author: {
                followers: {
                  some: {
                    followerId: req.user?.id,
                  },
                },
              },
            },
            {
              authorId: req.user?.id,
            },
          ],
        },
      });
      const totalPages = Math.ceil(totalPosts === 0 ? 1 : totalPosts / LIMIT);
      if (page > totalPages) page = totalPages;

      const offset = (page - 1) * LIMIT;

      const orderByValue: {
        likes?: { _count: "asc" | "desc" };
        createdAt?: "asc" | "desc";
      } = {};
      if (sort === "popular") {
        orderByValue.likes = { _count: "desc" };
      } else if (sort === "latest") {
        orderByValue.createdAt = "desc";
      } else if (sort === "oldest") {
        orderByValue.createdAt = "asc";
      } else {
        orderByValue.likes = { _count: "desc" };
      }

      const posts = await db.post.findMany({
        where: {
          OR: [
            {
              author: {
                followers: {
                  some: {
                    followerId: req.user?.id,
                  },
                },
              },
            },
            {
              authorId: req.user?.id,
            },
          ],
        },
        skip: offset,
        take: LIMIT,
        select: {
          id: true,
          caption: true,
          imageId: true,
          imageUrl: true,
          imageWidth: true,
          imageHeight: true,
          createdAt: true,
          updatedAt: true,
          author: {
            select: {
              id: true,
              name: true,
              username: true,
              profileImg: true,
              profileImgId: true,
            },
          },
          _count: {
            select: {
              likes: true,
              comments: true,
            },
          },
          likes: {
            where: {
              userId: req.user?.id,
            },
            select: {
              userId: true,
            },
          },
        },
        orderBy: [orderByValue, { id: "asc" }],
      });
      const finalPosts = posts.map((post) => {
        return {
          id: post.id,
          caption: post.caption,
          imageUrl: post.imageId
            ? cloudinary.url(post.imageId, {
                transformation: [
                  {
                    width: 1000,
                    crop: "scale",
                  },
                  {
                    quality: "auto",
                    fetch_format: "jpg",
                  },
                ],
              })
            : post.imageUrl,
          imageWidth: post.imageWidth,
          imageHeight: post.imageHeight,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
          author: {
            id: post.author.id,
            username: post.author.username,
            name: post.author.name,
            profileImg: post.author.profileImgId
              ? cloudinary.url(post.author.profileImgId, {
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
              : post.author.profileImg,
          },
          _count: {
            userLikes: post._count.likes,
            comments: post._count.comments,
          },
          likedByUser: post.likes.length > 0,
          userIsAuthor: req.user?.id === post.author.id,
        };
      });
      res.json({
        posts: finalPosts,
        currentPage: page,
        totalPages: totalPages,
      });
      return;
    }
  }),
];

// POST /posts
export const createPost_POST = [
  passport.authenticate("jwt", { session: false }),
  upload.single("image"),
  body("caption").trim().isLength({ min: 1, max: 2048 }),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);

    // upload image and get public url back

    if (!req.file) {
      throw new AppError(
        status.UNSUPPORTED_MEDIA_TYPE,
        "VALIDATION_ERROR",
        status[status.UNSUPPORTED_MEDIA_TYPE],
      );
    }
    let uploadResult;
    try {
      uploadResult = await cloudinary.uploader.upload(req.file?.path, {
        use_filename: true,
        asset_folder: "odin-book",
      });
    } catch (err) {
      await fs.rm(req.file.path);
      throw new AppError(
        500,
        "INTERNAL_SERVER_ERROR",
        "Error uploading to file storage",
      );
    }

    try {
      // save post to db
      await db.post.create({
        data: {
          authorId: req.user?.id!,
          caption: data.caption,
          imageUrl: uploadResult.secure_url,
          imageId: uploadResult.public_id,
          imageWidth: uploadResult.width,
          imageHeight: uploadResult.height,
        },
      });

      // if successful, delete image from local system
      await fs.rm(req.file.path);

      // return success message
      res.json({
        message: "post created successfully",
      });
      return;
    } catch (err) {
      console.log(err);
      console.log(
        "Must delete this file from cloudinary: ",
        uploadResult.public_id,
      );
      res.status(500).json({
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Error saving post.",
        },
      });
    }
  }),
];

// GET /posts/:postId
export const getPost_GET = [
  passport.authenticate("jwt", { session: false }),
  param("postId").isInt({ gt: 0 }),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    const postId = parseInt(data.postId);

    const post = await db.post.findUnique({
      where: {
        id: postId,
      },
      select: {
        id: true,
        caption: true,
        imageId: true,
        imageUrl: true,
        imageWidth: true,
        imageHeight: true,
        createdAt: true,
        updatedAt: true,
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            profileImg: true,
            profileImgId: true,
          },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
    });

    if (!post) {
      throw new AppError(404, "NOT_FOUND", "Post not found");
    }
    const userLikesPost = await db.postLike.findUnique({
      where: {
        userId_postId: {
          postId: post.id,
          userId: req.user?.id!,
        },
      },
    });

    res.json({
      post: {
        id: post.id,
        caption: post.caption,
        imageUrl: post.imageId
          ? cloudinary.url(post.imageId, {
              transformation: [
                {
                  width: 1000,
                  crop: "scale",
                },
                {
                  quality: "auto",
                  fetch_format: "jpg",
                },
              ],
            })
          : post.imageUrl,
        imageWidth: post.imageWidth,
        imageHeight: post.imageHeight,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        author: {
          id: post.author.id,
          name: post.author.name,
          username: post.author.username,
          profileImg: post.author.profileImgId
            ? cloudinary.url(post.author.profileImgId, {
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
            : post.author.profileImg,
        },
        _count: {
          userLikes: post._count.likes,
          comments: post._count.comments,
        },
        likedByUser: userLikesPost ? true : false,
        userIsAuthor: post.author.id === req.user?.id,
      },
    });
  }),
];

// PUT /posts/:postId
export const editPost_PUT = [
  passport.authenticate("jwt", { session: false }),
  upload.single("image"),
  param("postId").isInt({ gt: 0 }),
  body("caption").isLength({ min: 1, max: 2048 }),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    const caption = String(data.caption);
    const postId: number = parseInt(data.postId);

    const originalPost = await db.post.findUnique({
      where: {
        id: postId,
      },
      select: {
        id: true,
        imageId: true,
      },
    });
    // TODO: upload new image
    if (!req.file) {
      throw new AppError(
        500,
        "INTERNAL_SERVER_ERROR",
        "file to upload not found",
      );
    }

    const uploadResult = await cloudinary.uploader.upload(req.file.path, {
      use_filename: true,
      asset_folder: "odin-book",
    });

    // If image uploads successfully,
    // TODO: delete original image in cloudinary
    if (originalPost?.imageId) {
      const deleteImageRes = await cloudinary.uploader.destroy(
        originalPost?.imageId,
      );
      if (deleteImageRes.result === "ok") {
        console.log("old picture deleted");
      } else {
        throw new AppError(
          500,
          "INTERNAL_SERVER_ERROR",
          "Could not delete old image",
        );
      }
    }

    const updatedPost = await db.post.update({
      where: {
        id: originalPost?.id,
      },
      data: {
        imageUrl: uploadResult.secure_url,
        imageId: uploadResult.public_id,
        imageWidth: uploadResult.width,
        imageHeight: uploadResult.height,
        caption: caption,
      },
    });
    res.json({
      message: "Post updated successfully",
      postId: updatedPost.id,
    });
  }),
];

// DELETE /posts/:postId
export const deletePost_DELETE = [
  passport.authenticate("jwt", { session: false }),
  param("postId").isInt({ gt: 0 }),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    const postId: number = parseInt(data.postId);

    const post = await db.post.findUnique({
      where: {
        id: postId,
      },
      select: {
        id: true,
        author: {
          select: {
            id: true,
            role: true,
          },
        },
        imageId: true,
        imageUrl: true,
      },
    });
    if (!post) {
      throw new AppError(404, "NOT_FOUND", "Post not found");
    }

    if (!req.user) {
      throw new AppError(
        500,
        "INTERNAL_SERVER_ERROR",
        "Current user not found",
      );
    }

    const canDelete =
      req.user.role === "ADMIN" || req.user.id === post.author.id;
    if (!canDelete) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "You are not allowed to perform this action",
      );
    }
    // TODO: Delete image from cloudinary
    if (post.imageId) {
      const result = await cloudinary.uploader.destroy(post.imageId);
      if (result.result === "ok") {
        console.log("Image deleted from cloudinary");
        await db.post.delete({
          where: {
            id: post.id,
          },
        });
        res.json({ success: true, message: "Post deleted successfuly" });
        return;
      } else {
        throw new AppError(
          500,
          "INTERNAL_SERVER_ERROR",
          "Failure deleting image from post",
        );
      }
    }

    // TODO: delete DB record
    await db.post.delete({
      where: {
        id: post.id,
      },
    });

    // TODO: return response.
    res.json({ success: true, message: "Post deleted successfuly" });
  }),
];

// POST /posts/:postId/likes
export const likePost_POST = [
  passport.authenticate("jwt", { session: false }),
  param("postId").isInt(),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    const postId = parseInt(data.postId);

    const post = await db.post.findUnique({
      where: {
        id: postId,
      },
      select: {
        id: true,
      },
    });

    if (!post) {
      const error = new AppError(404, "NOT_FOUND", "post not found");
      res.status(error.status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    const likeExist = await db.postLike.findUnique({
      where: {
        userId_postId: {
          userId: req.user?.id!,
          postId: postId,
        },
      },
    });
    if (!likeExist) {
      await db.postLike.create({
        data: {
          userId: req.user?.id!,
          postId: postId,
        },
      });
    }

    res.json({
      success: true,
      message: "post liked",
    });
  }),
];

// DELETE /posts/:postId/like
export const unlikePost_DELETE = [
  passport.authenticate("jwt", { session: false }),
  param("postId").isInt(),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    const postId = parseInt(data.postId);

    const post = await db.post.findUnique({
      where: {
        id: postId,
      },
      select: {
        id: true,
      },
    });

    if (!post) {
      const error = new AppError(404, "NOT_FOUND", "post not found");
      res.status(error.status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    await db.postLike.deleteMany({
      where: {
        userId: req.user?.id!,
        postId: post.id,
      },
    });

    res.json({
      success: true,
      message: "post unliked",
    });
  }),
];

// GET /posts/:postId/comments
export const getComments_GET = [
  passport.authenticate("jwt", { session: false }),
  param("postId").isInt(),
  query("page").isInt({ gt: 0 }),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    const postId = parseInt(data.postId);
    let page = parseInt(data.page);
    const LIMIT = 15;

    const post = await db.post.findUnique({
      where: {
        id: postId,
      },
      select: { id: true },
    });
    if (!post) {
      const error = new AppError(404, "NOT_FOUND", "Post Not Found");
      res.status(error.status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    const totalComments = await db.comment.count({
      where: {
        postId: postId,
      },
    });
    const totalPages = Math.ceil(
      totalComments === 0 ? 1 : totalComments / LIMIT,
    );
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * LIMIT;

    const comments = await db.comment.findMany({
      where: {
        postId: postId,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: offset,
      take: LIMIT,
      select: {
        id: true,
        author: {
          select: {
            id: true,
            name: true,
            profileImg: true,
            profileImgId: true,
          },
        },
        message: true,
        createdAt: true,
        updatedAt: true,
        postId: true,
        _count: {
          select: {
            likes: true,
          },
        },
        likes: {
          select: {
            userId: true,
          },
        },
      },
    });
    const finalComments = comments.map((comment) => ({
      id: comment.id,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      message: comment.message,
      postId: comment.postId,
      author: {
        id: comment.author.id,
        name: comment.author.name,
        profileImg: comment.author.profileImgId
          ? cloudinary.url(comment.author.profileImgId, {
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
          : comment.author.profileImg,
      },
      _count: {
        userLikes: comment._count.likes,
      },
      userLikedComment: comment.likes.some(
        (user) => user.userId === req.user?.id,
      ),
      userIsAuthor: comment.author.id === req.user?.id,
    }));

    res.json({
      comments: finalComments,
      totalPages: totalPages,
      currentPage: page,
    });
    return;
  }),
];

// POST /posts/:postId/comments
export const postComment_POST = [
  passport.authenticate("jwt", { session: false }),
  param("postId").isInt({ gt: 0 }),
  body("message")
    .trim()
    .isLength({ min: 1, max: 2048 })
    .withMessage("Comment should be less than 2048 characters"),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);
    const postId = parseInt(data.postId);
    const message = String(data.message);

    const post = await db.post.findUnique({
      where: {
        id: postId,
      },
      select: {
        id: true,
      },
    });
    if (!post) {
      const error = new AppError(404, "NOT_FOUND", "Post not found");
      res.status(error.status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    const result = await db.comment.create({
      data: {
        authorId: req.user?.id!,
        message: message,
        postId: postId,
      },
    });
    res.json({
      success: true,
      message: "Comment created",
      comment: result,
    });
  }),
];

// PUT /posts/:postId/comments/:commentId
export const editComment_PUT = [
  passport.authenticate("jwt", { session: false }),
  param("postId").isInt({ gt: 0 }),
  param("commentId").isInt({ gt: 0 }),
  body("message")
    .trim()
    .isLength({ min: 1, max: 2048 })
    .withMessage("message must be between 1 and 2048 characters"),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);

    const postId = parseInt(data.postId);
    const commentId = parseInt(data.commentId);
    const message = String(data.message);

    const originalComment = await db.comment.findUnique({
      where: {
        id: commentId,
      },
      select: {
        id: true,
        authorId: true,
      },
    });
    if (!originalComment) {
      const error = new AppError(404, "NOT_FOUND", "Comment not found");
      next(error);
      return;
    }
    const user = await db.user.findUnique({
      where: {
        id: req.user?.id,
      },
      select: {
        id: true,
        role: true,
      },
    });
    if (!user) {
      const error = new AppError(401, "UNAUTHORIZED", "User not found");
      next(error);
      return;
    }
    const canEdit =
      user.role === "ADMIN" || originalComment.authorId === user.id;
    if (!canEdit) {
      const error = new AppError(
        403,
        "FORBIDDEN",
        "You are forbidden from performing this action",
      );
      next(error);
      return;
    }
    await db.comment.update({
      where: {
        id: originalComment.id,
      },
      data: {
        message: message,
      },
    });
    res.json({
      success: true,
      message: "comment updated successfully",
    });
  }),
];

// DELETE /posts/:postId/comments/:commentId
export const deleteComment_DELETE = [
  passport.authenticate("jwt", { session: false }),
  param("postId").isInt({ gt: 0 }),
  param("commentId").isInt({ gt: 0 }),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);

    const postId = parseInt(data.postId);
    const commentId = parseInt(data.commentId);

    const comment = await db.comment.findUnique({
      where: {
        id: commentId,
      },
      select: {
        id: true,
        authorId: true,
      },
    });
    if (!comment) {
      const error = new AppError(404, "NOT_FOUND", "Comment not found");
      next(error);
      return;
    }
    const user = await db.user.findUnique({
      where: {
        id: req.user?.id,
      },
      select: {
        id: true,
        role: true,
      },
    });
    if (!user) {
      const error = new AppError(401, "UNAUTHORIZED", "User not in db");
      next(error);
      return;
    }

    const canDelete = user.role === "ADMIN" || user.id === comment.authorId;
    if (!canDelete) {
      const error = new AppError(
        403,
        "FORBIDDEN",
        "You are not admin nor the author of this comment",
      );
      next(error);
      return;
    }

    await db.comment.delete({
      where: {
        id: comment.id,
      },
    });
    res.json({
      success: true,
      message: "Successfully deleted comment",
    });
  }),
];

// POST /posts/:postId/comments/:commentId/like
export const likeComment_POST = [
  passport.authenticate("jwt", { session: false }),
  param("postId").isInt({ gt: 0 }),
  param("commentId").isInt({ gt: 0 }),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);

    const postId = parseInt(data.postId);
    const commentId = parseInt(data.commentId);

    const comment = await db.comment.findUnique({
      where: {
        id: commentId,
      },
      select: {
        id: true,
      },
    });

    if (!comment) {
      const error = new AppError(404, "NOT_FOUND", "Comment not found");
      next(error);
      return;
    }

    await db.commentLike.create({
      data: {
        userId: req.user?.id!,
        commentId: comment.id,
      },
    });

    res.json({
      success: true,
      message: "Comment Liked successfully",
    });
  }),
];

// DELETE /posts/:postId/comments/:commentId/like
export const likeComment_DELETE = [
  passport.authenticate("jwt", { session: false }),
  param("postId").isInt({ gt: 0 }),
  param("commentId").isInt({ gt: 0 }),
  validateErrors,
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = matchedData(req);

    const postId = parseInt(data.postId);
    const commentId = parseInt(data.commentId);

    const comment = await db.comment.findUnique({
      where: {
        id: commentId,
      },
      select: {
        id: true,
      },
    });

    if (!comment) {
      const error = new AppError(404, "NOT_FOUND", "Comment not found");
      next(error);
      return;
    }

    await db.commentLike.deleteMany({
      where: {
        userId: req.user?.id!,
        commentId: comment.id,
      },
    });
    res.json({
      success: true,
      message: "Comment Unliked successfully",
    });
  }),
];
