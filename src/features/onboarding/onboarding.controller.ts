import type { NextFunction, Request, Response } from "express";
import { ApiError, sendApiError } from "../../shared/api-error";
import { serializeRecord } from "../../shared/record-serializer";
import { OnboardingService } from "./onboarding.service";
import { parseOnboarding } from "./onboarding.validation";

const service = new OnboardingService();
const owner = (request: Request) => {
  if (!request.userId) throw new ApiError(401, "A Supabase bearer token is required");
  return request.userId;
};

export const onboardingController = {
  create: async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.status(201).json(serializeRecord(await service.create(owner(request), parseOnboarding(request.body))));
    } catch (error) {
      sendApiError(error, response, next);
    }
  },
};
