import express from "express";
import * as authController from "../controllers/authController.ts";

const router = express.Router();

// all routes prefixed with /auth
router.post("/signup", authController.signup_POST);
router.post("/signin", authController.signin_POST);
router.post("/logout", authController.logout_POST);
router.post("/refresh", authController.refreshToken_POST);
router.get("/check", authController.check_GET);
router.get("/google", authController.googleLogin_GET);
router.get("/google/callback", authController.googleLoginCallback_GET);

export default router;
