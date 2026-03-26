import { createId } from "@paralleldrive/cuid2";
import db from "../db/db";

export async function createRefreshToken(userId: string) {
  const now = new Date(Date.now());
  // This creates an expiration date of 60 days
  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  const refreshToken = await db.refreshToken.create({
    data: {
      token: createId(),
      userId: userId,
      createdAt: now,
      updatedAt: now,
      expiresAt: expiresAt,
    },
  });
  return refreshToken;
}
