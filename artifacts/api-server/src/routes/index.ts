import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storesRouter from "./stores";
import ordersRouter from "./orders";
import routeRouter from "./route";
import analyticsRouter from "./analytics";
import settingsRouter from "./settings";
import geocodeRouter from "./geocode";
import driverRouter from "./driver";
import driversRouter from "./drivers";
import telegramRouter from "./telegram";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storesRouter);
router.use(ordersRouter);
router.use(routeRouter);
router.use(analyticsRouter);
router.use(settingsRouter);
router.use(geocodeRouter);
router.use(driverRouter);
router.use(driversRouter);
router.use(telegramRouter);

export default router;
