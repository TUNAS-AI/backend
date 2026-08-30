const swaggerJSDoc = require("swagger-jsdoc");

const bearerAuth = [{ bearerAuth: [] }];
const resourceIdParameter = { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } };

function jsonRequest(schema: string) {
  return {
    required: true,
    content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } },
  };
}

function dataOperation(tag: string, summary: string, responses: Record<number, { description: string }>) {
  return { tags: [tag], summary, security: bearerAuth, responses };
}

function collectionEndpoints(tag: string, plural: string, singular: string, createSchema: string) {
  return {
    get: dataOperation(tag, `List ${plural}`, { 200: { description: plural } }),
    post: { ...dataOperation(tag, `Create ${singular}`, { 201: { description: `${singular} created` } }), requestBody: jsonRequest(createSchema) },
  };
}

function resourceEndpoints(tag: string, singular: string, updateSchema: string) {
  return {
    get: { ...dataOperation(tag, `Get ${singular}`, { 200: { description: singular } }), parameters: [resourceIdParameter] },
    patch: { ...dataOperation(tag, `Update ${singular}`, { 200: { description: `${singular} updated` } }), parameters: [resourceIdParameter], requestBody: jsonRequest(updateSchema) },
    delete: { ...dataOperation(tag, `Delete ${singular}`, { 204: { description: `${singular} deleted` } }), parameters: [resourceIdParameter] },
  };
}

export const openApiDocument = swaggerJSDoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Hijau AI Backend API",
      version: "1.0.0",
      description: "The web app uses Google sign-in through its frontend callback. Swagger has its own browser-only token handoff.",
    },
    servers: [{ url: "http://localhost:3000", description: "Local development" }],
    tags: [{ name: "Authentication" }, { name: "Onboarding" }, { name: "Farms" }, { name: "Field blocks" }, { name: "Crop batches" }, { name: "Missions" }, { name: "TUNAS" }, { name: "Telegram" }, { name: "System" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string" } },
        },
        WorkingHoursRange: {
          type: "object",
          required: ["start", "end"],
          properties: {
            start: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$", example: "10:00" },
            end: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$", example: "15:00" },
          },
        },
        WeeklyWorkingHours: {
          type: "object",
          additionalProperties: false,
          properties: {
            monday: { type: "array", items: { $ref: "#/components/schemas/WorkingHoursRange" } },
            tuesday: { type: "array", items: { $ref: "#/components/schemas/WorkingHoursRange" } },
            wednesday: { type: "array", items: { $ref: "#/components/schemas/WorkingHoursRange" } },
            thursday: { type: "array", items: { $ref: "#/components/schemas/WorkingHoursRange" } },
            friday: { type: "array", items: { $ref: "#/components/schemas/WorkingHoursRange" } },
            saturday: { type: "array", items: { $ref: "#/components/schemas/WorkingHoursRange" } },
            sunday: { type: "array", items: { $ref: "#/components/schemas/WorkingHoursRange" } },
          },
          example: {
            monday: [{ start: "07:00", end: "10:00" }, { start: "13:00", end: "15:00" }],
            wednesday: [{ start: "10:00", end: "15:00" }],
          },
        },
        FarmCreateInput: {
          type: "object",
          required: ["name", "defaultWorkerCount"],
          properties: {
            name: { type: "string", example: "Kebun Cisarua" },
            location: { type: "string", nullable: true, example: "Bogor" },
            notes: { type: "string", nullable: true, example: "Near the village road." },
            timezone: { type: "string", example: "Asia/Jakarta" },
            defaultWorkerCount: { type: "integer", minimum: 1, example: 5 },
            rainProtectionAvailable: { type: "boolean", nullable: true, example: true },
            defaultWorkingHours: { $ref: "#/components/schemas/WeeklyWorkingHours" },
          },
        },
        DryingProfile: { type: "object", required: ["method", "capacityKg", "protectedCapacityKg", "minDays", "maxDays"], additionalProperties: false, properties: { method: { type: "string", enum: ["FIELD_SUN", "RACK_SUN", "COVERED_VENTILATED", "INSTORE"] }, capacityKg: { type: "number", exclusiveMinimum: 0 }, protectedCapacityKg: { type: "number", minimum: 0 }, minDays: { type: "number", minimum: 1 }, maxDays: { type: "number", minimum: 1 } } },
        SchedulingDurations: { type: "object", required: ["readinessCheckMinutes", "harvestMinutes", "transferToDryingMinutes", "beginDryingMinutes", "dryingInspectionMinutes"], additionalProperties: false, properties: { readinessCheckMinutes: { type: "integer", minimum: 1, example: 15 }, harvestMinutes: { type: "integer", minimum: 1, example: 360 }, transferToDryingMinutes: { type: "integer", minimum: 1, example: 30 }, beginDryingMinutes: { type: "integer", minimum: 1, example: 15 }, dryingInspectionMinutes: { type: "integer", minimum: 1, example: 30 } } },
        FarmUpdateInput: {
          type: "object",
          properties: {
            name: { type: "string", example: "Kebun Cisarua" },
            location: { type: "string", nullable: true, example: "Bogor" },
            notes: { type: "string", nullable: true, example: "Near the village road." },
            timezone: { type: "string", example: "Asia/Jakarta" },
            defaultWorkerCount: { type: "integer", minimum: 1, example: 5 },
            rainProtectionAvailable: { type: "boolean", nullable: true, example: true },
            defaultWorkingHours: { $ref: "#/components/schemas/WeeklyWorkingHours" },
            dryingProfile: { $ref: "#/components/schemas/DryingProfile" },
            schedulingDurations: { $ref: "#/components/schemas/SchedulingDurations" },
          },
        },
        FarmDeleteInput: {
          type: "object",
          required: ["confirmation"],
          properties: { confirmation: { type: "string", enum: ["DELETE_FARM"], example: "DELETE_FARM" } },
        },
        FieldBlockCreateInput: {
          type: "object",
          required: ["name", "coordinates"],
          properties: {
            name: { type: "string", example: "North Block" },
            areaHectares: { type: "number", exclusiveMinimum: true, minimum: 0, nullable: true, example: 0.75 },
            coordinates: {
              type: "object",
              required: ["latitude", "longitude"],
              properties: {
                latitude: { type: "number", minimum: -90, maximum: 90, example: -6.914744 },
                longitude: { type: "number", minimum: -180, maximum: 180, example: 107.60981 },
              },
            },
            notes: { type: "string", nullable: true, example: "Truck access is narrow after rain." },
            status: { type: "string", example: "active" },
          },
        },
        FieldBlockUpdateInput: {
          type: "object",
          properties: {
            name: { type: "string", example: "North Block" },
            areaHectares: { type: "number", exclusiveMinimum: true, minimum: 0, nullable: true, example: 0.75 },
            coordinates: {
              type: "object",
              required: ["latitude", "longitude"],
              properties: {
                latitude: { type: "number", minimum: -90, maximum: 90, example: -6.914744 },
                longitude: { type: "number", minimum: -180, maximum: 180, example: 107.60981 },
              },
            },
            notes: { type: "string", nullable: true, example: "Truck access is narrow after rain." },
            status: { type: "string", example: "active" },
          },
        },
        CropBatchCreateInput: {
          type: "object",
          required: ["fieldBlockId", "readinessStatus"],
          properties: {
            fieldBlockId: { type: "string", format: "uuid" },
            variety: { type: "string", nullable: true, example: "Bima Brebes" },
            plantingDate: { type: "string", format: "date", nullable: true, example: "2026-05-15" },
            notes: { type: "string", nullable: true },
            status: { type: "string", example: "active" },
            readinessStatus: { type: "string", enum: ["READY", "NOT_READY"] },
          },
        },
        CropBatchUpdateInput: {
          type: "object",
          properties: {
            fieldBlockId: { type: "string", format: "uuid" },
            variety: { type: "string", nullable: true, example: "Bima Brebes" },
            plantingDate: { type: "string", format: "date", nullable: true },
            notes: { type: "string", nullable: true },
            status: { type: "string" },
            readinessStatus: { type: "string", enum: ["READY", "NOT_READY"] },
          },
        },
        OnboardingCropBatchInput: {
          type: "object",
          required: ["readinessStatus"],
          properties: {
            variety: { type: "string", nullable: true, example: "Bima Brebes" },
            plantingDate: { type: "string", format: "date", nullable: true, example: "2026-05-15" },
            notes: { type: "string", nullable: true },
            readinessStatus: { type: "string", enum: ["READY", "NOT_READY"] },
          },
        },
        OnboardingFieldInput: {
          type: "object",
          required: ["name", "coordinates", "cropBatches"],
          properties: {
            name: { type: "string", example: "North Block" },
            areaHectares: { type: "number", exclusiveMinimum: true, minimum: 0, nullable: true, example: 0.75 },
            coordinates: { type: "object", required: ["latitude", "longitude"], properties: { latitude: { type: "number" }, longitude: { type: "number" } } },
            notes: { type: "string", nullable: true },
            cropBatches: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/OnboardingCropBatchInput" } },
          },
        },
        OnboardingCreateInput: {
          type: "object",
          required: ["farm", "fields"],
          properties: {
            farm: { allOf: [{ $ref: "#/components/schemas/FarmCreateInput" }, { required: ["defaultWorkingHours"] }] },
            fields: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/OnboardingFieldInput" } },
          },
        },
        MissionPreviewMessageInput: {
          type: "object", required: ["role", "content"], additionalProperties: false,
          properties: { role: { type: "string", enum: ["farmer", "assistant"] }, content: { type: "string", minLength: 1, maxLength: 4000 } },
        },
        MissionPreviewFactsInput: {
          type: "object", required: ["fieldBlockId", "cropBatchIds", "readinessConfirmed", "destination", "plannedHarvestKg", "deadlineAt", "notes", "clarification"], additionalProperties: false,
          properties: {
            fieldBlockId: { type: "string", format: "uuid", nullable: true }, cropBatchIds: { type: "array", maxItems: 12, items: { type: "string", format: "uuid" } },
            readinessConfirmed: { type: "boolean", nullable: true }, deadlineAt: { type: "string", format: "date-time", nullable: true },
            readinessStatus: { type: "string", enum: ["READY", "NOT_READY", "UNSURE", "ALMOST_READY"], nullable: true }, readinessConfirmedAt: { type: "string", format: "date-time", nullable: true }, destination: { type: "string", enum: ["IMMEDIATE_SALE", "CONSUMPTION_STORAGE", "SEED_STOCK"], nullable: true }, plannedHarvestKg: { type: "number", minimum: 0, nullable: true }, plannedDriedKg: { type: "number", minimum: 0, nullable: true }, harvestWindowStart: { type: "string", format: "date-time", nullable: true }, harvestWindowEnd: { type: "string", format: "date-time", nullable: true }, buyerPickupAt: { type: "string", format: "date-time", nullable: true }, deadlineSemantics: { type: "string", enum: ["HARVEST_COMPLETE", "DRYING_COMPLETE", "PICKUP", "DELIVERY"], nullable: true }, priority: { type: "string", enum: ["LOWEST_RAIN_RISK"], nullable: true }, partialFulfillmentAllowed: { type: "boolean", nullable: true }, minimumPartialKg: { type: "number", minimum: 0, nullable: true }, harvestDurationHours: { type: "number", minimum: 0, nullable: true }, preparationDurationHours: { type: "number", minimum: 0, nullable: true }, bundlingDurationHours: { type: "number", minimum: 0, nullable: true }, transferMinutesPerTrip: { type: "number", minimum: 0, nullable: true }, dryingSetupDurationHours: { type: "number", minimum: 0, nullable: true }, inspectionDurationMinutes: { type: "number", minimum: 0, nullable: true }, turningDurationMinutes: { type: "number", minimum: 0, nullable: true }, estimatedHarvestableKg: { type: "number", minimum: 0, nullable: true }, availableWorkerCount: { type: "integer", minimum: 1, nullable: true }, vehiclePayloadKg: { type: "number", minimum: 0, nullable: true }, temporaryHoldingCapacityKg: { type: "number", minimum: 0, nullable: true }, dryingMethod: { type: "string", enum: ["FIELD_SUN", "RACK_SUN", "COVERED_VENTILATED", "INSTORE"], nullable: true }, dryingCapacityKg: { type: "number", minimum: 0, nullable: true }, dryingExposure: { type: "string", enum: ["EXPOSED", "COVERABLE", "PROTECTED"], nullable: true }, protectedCapacityKg: { type: "number", minimum: 0, nullable: true }, coverDeploymentMinutes: { type: "number", minimum: 0, nullable: true }, coverCrewRequired: { type: "integer", minimum: 0, nullable: true }, dryingEstimatedMinDays: { type: "number", minimum: 0, nullable: true }, dryingEstimatedMaxDays: { type: "number", minimum: 0, nullable: true }, inspectionCadenceDays: { type: "number", minimum: 0, nullable: true }, turningCadenceDays: { type: "number", minimum: 0, nullable: true }, harvestMaxPrecipitationMm: { type: "number", minimum: 0, nullable: true }, harvestMaxProbabilityPct: { type: "number", minimum: 0, maximum: 100, nullable: true }, exposedDryingMaxPrecipitationMm: { type: "number", minimum: 0, nullable: true }, coverTriggerProbabilityPct: { type: "number", minimum: 0, maximum: 100, nullable: true }, forecastRecheckLeadHours: { type: "number", minimum: 0, nullable: true }, notes: { type: "string", nullable: true },
            clarification: { type: "object", nullable: true, required: ["key", "question"], properties: { key: { type: "string" }, question: { type: "string" } } },
          },
        },
        MissionFactBlockInput: {
          type: "object", required: ["key", "value", "provenance", "confidence"], additionalProperties: false,
          properties: { key: { type: "string" }, value: {}, provenance: { type: "string", enum: ["FARMER_REPORTED", "INFERRED"] }, confidence: { type: "string", enum: ["high", "medium", "low"] } },
        },
        MissionFactReview: {
          type: "object", required: ["key", "status", "reason", "provenance", "confidence"], additionalProperties: false,
          properties: { key: { type: "string" }, status: { type: "string", enum: ["confirmed", "needs_clarification", "missing"] }, reason: { type: "string" }, provenance: { type: "string", enum: ["FARMER_REPORTED", "INFERRED"] }, confidence: { type: "string", enum: ["high", "medium", "low"] } },
        },
        MissionPreviewCandidateInput: {
          type: "object", required: ["previewId", "messages", "facts"], additionalProperties: false,
          properties: { previewId: { type: "string", format: "uuid" }, messages: { type: "array", minItems: 1, maxItems: 40, items: { $ref: "#/components/schemas/MissionPreviewMessageInput" } }, facts: { $ref: "#/components/schemas/MissionPreviewFactsInput" } },
        },
        MissionPreviewInterpretInput: { type: "object", required: ["message"], additionalProperties: false, properties: { previewId: { type: "string", format: "uuid" }, messages: { type: "array", maxItems: 39, items: { $ref: "#/components/schemas/MissionPreviewMessageInput" } }, facts: { $ref: "#/components/schemas/MissionPreviewFactsInput" }, message: { type: "string", minLength: 1, maxLength: 4000, example: "Panen 80 kg besok dari Blok Timur." } } },
        MissionPreviewPlanInput: { type: "object", required: ["candidate"], additionalProperties: false, properties: { candidate: { $ref: "#/components/schemas/MissionPreviewCandidateInput" } } },
        MissionConfirmInput: { type: "object", required: ["previewToken", "planId"], properties: { previewToken: { type: "string" }, planId: { type: "string", format: "uuid" } } },
        MissionReplanConfirmInput: { type: "object", required: ["previewToken", "planId"], properties: { previewToken: { type: "string" }, planId: { type: "string", format: "uuid" } } },
        MissionStageInput: { type: "object", required: ["stage"], properties: { stage: { type: "string", enum: ["HARVESTING", "DRYING", "FINISHED", "TO_REVIEW"] } } },
        MissionStepStatusInput: { type: "object", required: ["status"], properties: { status: { type: "string", enum: ["IN_PROGRESS", "COMPLETED"] } } },
        MissionScheduledStep: { type: "object", description: "Separately completable mission action. Timed actions use non-overlapping farm-configured durations; drying completion is a condition gate.", properties: { actionKind: { type: "string", enum: ["CONFIRM_READINESS_WEATHER", "HARVEST", "TRANSFER_TO_DRYING", "BEGIN_DRYING", "INSPECT_DRYING", "CONFIRM_DRYING_COMPLETE"] }, scheduleType: { type: "string", enum: ["DAILY_WINDOW", "CONDITION_GATE"] }, startsOn: { type: "string", format: "date" }, endsOn: { type: "string", format: "date" }, windowStart: { type: "string", nullable: true, example: "08:00" }, windowEnd: { type: "string", nullable: true, example: "08:15" }, timezone: { type: "string", example: "Asia/Jakarta" } } },
        MissionCloseoutInput: { type: "object", required: ["actualHarvestKg", "actualDriedKg", "dryingCompleted"], properties: { actualHarvestKg: { type: "number", minimum: 0 }, actualDriedKg: { type: "number", minimum: 0 }, harvestedAreaHectares: { type: "number", minimum: 0, nullable: true }, dryingCompleted: { type: "boolean" }, rejectedKg: { type: "number", minimum: 0, nullable: true }, notes: { type: "string", nullable: true } } },
        OperationalReportInput: { type: "object", required: ["reportType", "observedAt", "payload"], additionalProperties: false, description: "Strict report-specific payload. Activity reports also require missionStepId; buyer requirement reports require quantityBasis HARVESTED or DRIED; corrections set supersedesReportId.", properties: { reportType: { type: "string", enum: ["ACTIVITY_STARTED", "ACTIVITY_COMPLETED", "ACTUAL_QUANTITY_REPORTED", "WORKER_AVAILABILITY_CHANGED", "BUYER_REQUIREMENT_CHANGED", "DRYING_RESOURCE_CHANGED", "DRYING_INSPECTION", "RAIN_OR_FIELD_EVENT", "MISSION_DEVIATION", "GENERAL_OPERATIONAL_NOTE"] }, observedAt: { type: "string", format: "date-time" }, missionStepId: { type: "string", format: "uuid" }, fieldBlockId: { type: "string", format: "uuid" }, cropBatchId: { type: "string", format: "uuid" }, narrative: { type: "string", maxLength: 4000 }, supersedesReportId: { type: "string", format: "uuid" }, payload: { type: "object" } } },
        TunasInteractionInput: { type: "object", additionalProperties: false, oneOf: [{ required: ["message"] }, { required: ["report"] }], properties: { message: { type: "string", minLength: 1, maxLength: 4000 }, report: { $ref: "#/components/schemas/OperationalReportInput" }, missionId: { type: "string", format: "uuid", nullable: true }, channel: { type: "string", default: "web", maxLength: 40 }, externalMessageId: { type: "string", maxLength: 200, description: "Required unless Idempotency-Key is supplied." } } },
        OperationalPendingAction: { type: "object", required: ["pendingActionId", "kind", "status", "preview", "actions"], properties: { pendingActionId: { type: "string", format: "uuid" }, kind: { type: "string", enum: ["CLARIFICATION", "MISSION_NOTES", "MISSION_STAGE", "MISSION_STEP_STATUS", "CLOSEOUT", "OPERATIONAL_REPORT"] }, status: { type: "string" }, preview: { type: "object", properties: { before: {}, after: {} } }, actions: { type: "object", properties: { approve: { type: "string" }, reject: { type: "string" } } }, semanticActions: { type: "array", items: { type: "object" } } } },
      },
    },
    paths: {
      "/api/auth/google": {
        get: {
          tags: ["Authentication"],
          summary: "Start Google sign-in",
          description: "Starts Google sign-in for the configured frontend callback.",
          responses: {
            302: { description: "Redirects to Supabase Google OAuth" },
            503: { description: "Google sign-in is not configured", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/api/auth/google/swagger": {
        get: {
          tags: ["Authentication"],
          summary: "Start Google sign-in for Swagger",
          description: "Use this browser-only flow to preauthorize Swagger UI in the current tab.",
          responses: {
            302: { description: "Redirects to Supabase Google OAuth" },
            503: { description: "Google sign-in is not configured", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/api/auth/google/callback": {
        get: {
          tags: ["Authentication"],
          summary: "Complete Swagger browser sign-in",
          description: "Stores the token in session storage only long enough for Swagger UI to authorize this browser tab.",
          responses: { 200: { description: "Google sign-in callback page" } },
        },
      },
      "/api/session": {
        get: {
          tags: ["Authentication"],
          summary: "Verify the current bearer token",
          security: bearerAuth,
          responses: {
            200: { description: "Authenticated Supabase user identity" },
            401: { description: "Missing, invalid, or expired token", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            503: { description: "Authentication is not configured", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/api/farm": {
        get: dataOperation("Farms", "Get the caller's farm profile", { 200: { description: "Farm profile" }, 404: { description: "No farm profile" } }),
        post: { ...dataOperation("Farms", "Create the caller's farm profile", { 201: { description: "Farm profile created" }, 409: { description: "Farm profile already exists" } }), requestBody: jsonRequest("FarmCreateInput") },
        patch: { ...dataOperation("Farms", "Update the caller's farm profile", { 200: { description: "Farm profile updated" } }), requestBody: jsonRequest("FarmUpdateInput") },
        delete: { ...dataOperation("Farms", "Delete the caller's farm profile and related data", { 204: { description: "Farm profile deleted" } }), requestBody: jsonRequest("FarmDeleteInput") },
      },
      "/api/farm/snapshot": {
        get: dataOperation("Farms", "Get the caller's farm, field blocks, and crop batches", { 200: { description: "Farm snapshot" }, 404: { description: "No farm profile" } }),
      },
      "/api/onboarding": {
        post: { ...dataOperation("Onboarding", "Create the caller's initial farm, fields, and crop batches", { 201: { description: "Farm setup created" }, 409: { description: "Farm profile already exists" } }), requestBody: jsonRequest("OnboardingCreateInput") },
      },
      "/api/field-blocks": collectionEndpoints("Field blocks", "field blocks", "a field block", "FieldBlockCreateInput"),
      "/api/field-blocks/{id}": resourceEndpoints("Field blocks", "a field block", "FieldBlockUpdateInput"),
      "/api/crop-batches": collectionEndpoints("Crop batches", "crop batches", "a crop batch", "CropBatchCreateInput"),
      "/api/crop-batches/{id}": resourceEndpoints("Crop batches", "a crop batch", "CropBatchUpdateInput"),
      "/api/missions": {
        get: dataOperation("Missions", "List the caller's missions", { 200: { description: "Missions" } }),
        post: { ...dataOperation("Missions", "Confirm a signed planning preview", { 201: { description: "Active waiting mission created" }, 409: { description: "Preview is expired or invalid" } }), requestBody: jsonRequest("MissionConfirmInput") },
      },
      "/api/missions/calendar": { get: { ...dataOperation("Missions", "List pending approved mission steps for a calendar range", { 200: { description: "Pending mission steps" } }), parameters: [{ in: "query", name: "from", required: true, schema: { type: "string", format: "date" } }, { in: "query", name: "to", required: true, schema: { type: "string", format: "date" } }] } },
      "/api/missions/{id}": { get: { ...dataOperation("Missions", "Get a mission", { 200: { description: "Mission" }, 404: { description: "Mission not found" } }), parameters: [resourceIdParameter] }, delete: { ...dataOperation("Missions", "Permanently delete a mission", { 200: { description: "Deleted mission ID" }, 404: { description: "Mission not found" } }), parameters: [resourceIdParameter] } },
      "/api/missions/{id}/replan": { get: { ...dataOperation("Missions", "Load an active mission into a replan draft", { 200: { description: "Editable mission candidate" }, 409: { description: "Mission is not active" } }), parameters: [resourceIdParameter] } },
      "/api/missions/{id}/replan/interpret": { post: { ...dataOperation("Missions", "Interpret a natural-language mission change", { 200: { description: "Updated replacement candidate" } }), parameters: [resourceIdParameter], requestBody: jsonRequest("MissionPreviewInterpretInput") } },
      "/api/missions/{id}/replan/plan": { post: { ...dataOperation("Missions", "Generate three replacement plan options", { 200: { description: "Signed replacement plan preview" } }), parameters: [resourceIdParameter], requestBody: jsonRequest("MissionPreviewPlanInput") } },
      "/api/missions/{id}/replan/confirm": { post: { ...dataOperation("Missions", "Replace an active mission's approved plan", { 200: { description: "Updated mission" }, 409: { description: "Preview or mission changed" } }), parameters: [resourceIdParameter], requestBody: jsonRequest("MissionReplanConfirmInput") } },
      "/api/mission-previews/interpret": { post: { ...dataOperation("Missions", "Interpret a client-held mission preview", { 200: { description: "Updated fact blocks" } }), requestBody: jsonRequest("MissionPreviewInterpretInput") } },
      "/api/mission-previews/plan": { post: { ...dataOperation("Missions", "Generate a signed weather-aware preview", { 200: { description: "Plans and confirmation token" }, 409: { description: "Preview is incomplete" } }), requestBody: jsonRequest("MissionPreviewPlanInput") } },
      "/api/missions/{id}/stage": { post: { ...dataOperation("Missions", "Advance an active mission stage", { 200: { description: "Updated mission" }, 409: { description: "Invalid stage transition" } }), parameters: [resourceIdParameter], requestBody: jsonRequest("MissionStageInput") } },
      "/api/missions/{id}/steps/{stepId}/status": { post: { ...dataOperation("Missions", "Advance a current-stage mission step", { 200: { description: "Updated mission" }, 409: { description: "Invalid step transition" } }), parameters: [resourceIdParameter, { in: "path", name: "stepId", required: true, schema: { type: "string", format: "uuid" } }], requestBody: jsonRequest("MissionStepStatusInput") } },
      "/api/missions/{id}/closeout": { post: { ...dataOperation("Missions", "Record farmer-reported mission results", { 200: { description: "Mission awaiting closeout confirmation" }, 409: { description: "Mission is not ready for closeout" } }), parameters: [resourceIdParameter], requestBody: jsonRequest("MissionCloseoutInput") } },
      "/api/missions/{id}/closeout/confirm": { post: { ...dataOperation("Missions", "Confirm a recorded closeout", { 200: { description: "Completed mission" }, 409: { description: "Closeout is not ready" } }), parameters: [resourceIdParameter] } },
      "/api/telegram": { get: dataOperation("Telegram", "Read the caller's permanent Telegram connection status", { 200: { description: "Telegram connection status" } }) },
      "/api/telegram/connect": { post: dataOperation("Telegram", "Create a short-lived one-time Telegram account-link URL", { 200: { description: "Telegram connection URL or existing connection" }, 503: { description: "Telegram is not configured" } }) },
      "/api/telegram/webhook": { post: { tags: ["Telegram"], summary: "Receive secret-authenticated Telegram updates", parameters: [{ in: "header", name: "X-Telegram-Bot-Api-Secret-Token", required: true, schema: { type: "string" } }], responses: { 200: { description: "Update accepted" }, 401: { description: "Webhook secret rejected" } } } },
      "/api/tunas/daily-check": { post: dataOperation("TUNAS", "Check active mission weather and deliver material rain alerts", { 200: { description: "Current TUNAS messages" } }) },
      "/api/tunas/test-alerts/{scenario}": { post: { ...dataOperation("TUNAS", "Send a mission-bound Telegram rain alert demo", { 200: { description: "Demo alert persisted and delivered" }, 409: { description: "Mission is not eligible or Telegram is not connected" } }), parameters: [{ in: "path", name: "scenario", required: true, schema: { type: "string", enum: ["drying-rain", "harvest-rain", "irregular-rain"] } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["missionId"], additionalProperties: false, properties: { missionId: { type: "string", format: "uuid" } } } } } } } },
      "/api/tunas/interactions": {
        get: dataOperation("TUNAS", "Read completed operational interaction history", { 200: { description: "Ordered durable interactions and responses" } }),
        post: { ...dataOperation("TUNAS", "Route a durable operational interaction", { 200: { description: "Updated TunasState, including any pending clarification or mutation preview" }, 409: { description: "Duplicate interaction is still processing" } }), parameters: [{ in: "header", name: "Idempotency-Key", required: false, schema: { type: "string", maxLength: 200 } }], requestBody: jsonRequest("TunasInteractionInput") },
      },
      "/api/tunas/pending/{pendingActionId}/approve": { post: { ...dataOperation("TUNAS", "Approve and revalidate a pending mission mutation", { 200: { description: "Resolved TunasState" }, 409: { description: "Clarification cannot be approved" } }), parameters: [{ in: "path", name: "pendingActionId", required: true, schema: { type: "string", format: "uuid" } }] } },
      "/api/tunas/pending/{pendingActionId}/reject": { post: { ...dataOperation("TUNAS", "Reject a pending action without mutation", { 200: { description: "Resolved TunasState" } }), parameters: [{ in: "path", name: "pendingActionId", required: true, schema: { type: "string", format: "uuid" } }] } },
      "/api/tunas/missions/{id}/timeline": { get: { ...dataOperation("TUNAS", "Read the append-only operational audit timeline", { 200: { description: "Ordered operational events" }, 404: { description: "Mission not found" } }), parameters: [resourceIdParameter] } },
      "/api/tunas/missions/{id}/reports": { get: { ...dataOperation("TUNAS", "Read accepted operational report history", { 200: { description: "Newest-first accepted reports" }, 404: { description: "Mission not found" } }), parameters: [resourceIdParameter] } },
      "/health": {
        get: { tags: ["System"], summary: "Health check", responses: { 200: { description: "Service is healthy" } } },
      },
      "/health/ready": {
        get: { tags: ["System"], summary: "Mission dependency readiness", responses: { 200: { description: "Mission dependencies are ready" }, 503: { description: "Mission dependencies are not ready" } } },
      },
      "/": {
        get: { tags: ["System"], summary: "Service information", responses: { 200: { description: "Service metadata" } } },
      },
    },
  },
  apis: [],
});
