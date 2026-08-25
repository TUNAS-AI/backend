import { OnboardingRepository } from "./onboarding.repository";
import type { OnboardingInput } from "./onboarding.types";

export class OnboardingService {
  constructor(private readonly repository = new OnboardingRepository()) {}

  create(ownerId: string, input: OnboardingInput) {
    return this.repository.create(ownerId, input);
  }
}
