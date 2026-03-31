import db from "../db/db.ts";

export async function clearOldUserBans() {
  const now = new Date();
  try {
    const updatedUsersResult = await db.user.updateMany({
      where: {
        bannedUntil: {
          lte: now,
        },
      },
      data: {
        bannedUntil: null,
      },
    });
    console.log(`Unbanned ${updatedUsersResult.count} users.`);
  } catch (err) {
    console.error("Error unbanning users", err);
  }
}

export async function clearExpiredRefreshTokens() {
  const now = new Date(Date.now());
  try {
    const deletedRefreshTokens = await db.refreshToken.deleteMany({
      where: {
        expiresAt: {
          lte: now,
        },
      },
    });
    console.log(`Removed ${deletedRefreshTokens.count} expired tokens`);
  } catch (err) {
    console.log("Error removing expired refresh tokens", err);
  }
}
