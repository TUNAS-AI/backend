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
    tags: [{ name: "Authentication" }, { name: "Onboarding" }, { name: "Farms" }, { name: "Field blocks" }, { name: "Crop batches" }, { name: "Buyer commitments" }, { name: "System" }],
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
            defaultWorkingHours: { $ref: "#/components/schemas/WeeklyWorkingHours" },
          },
        },
        FarmUpdateInput: {
          type: "object",
          properties: {
            name: { type: "string", example: "Kebun Cisarua" },
            location: { type: "string", nullable: true, example: "Bogor" },
            notes: { type: "string", nullable: true, example: "Near the village road." },
            timezone: { type: "string", example: "Asia/Jakarta" },
            defaultWorkerCount: { type: "integer", minimum: 1, example: 5 },
            defaultWorkingHours: { $ref: "#/components/schemas/WeeklyWorkingHours" },
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
          required: ["fieldBlockId"],
          properties: {
            fieldBlockId: { type: "string", format: "uuid" },
            variety: { type: "string", nullable: true, example: "Bima Brebes" },
            plantingDate: { type: "string", format: "date", nullable: true, example: "2026-05-15" },
            notes: { type: "string", nullable: true },
            status: { type: "string", example: "active" },
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
          },
        },
        OnboardingCropBatchInput: {
          type: "object",
          properties: {
            variety: { type: "string", nullable: true, example: "Bima Brebes" },
            plantingDate: { type: "string", format: "date", nullable: true, example: "2026-05-15" },
            notes: { type: "string", nullable: true },
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
        BuyerCommitmentCreateInput: {
          type: "object",
          required: ["cropBatchId", "buyerName", "quantityKg", "deadline"],
          properties: {
            cropBatchId: { type: "string", format: "uuid" },
            buyerName: { type: "string", example: "Pasar Induk" },
            quantityKg: { type: "number", exclusiveMinimum: true, minimum: 0, example: 500 },
            targetGrade: { type: "string", nullable: true, example: "A" },
            deadline: { type: "string", format: "date-time", example: "2026-07-24T09:00:00.000Z" },
            notes: { type: "string", nullable: true, example: "No overtime" },
            status: { type: "string", example: "active" },
          },
        },
        BuyerCommitmentUpdateInput: {
          type: "object",
          properties: {
            cropBatchId: { type: "string", format: "uuid" },
            buyerName: { type: "string", example: "Pasar Induk" },
            quantityKg: { type: "number", exclusiveMinimum: true, minimum: 0, example: 500 },
            targetGrade: { type: "string", nullable: true },
            deadline: { type: "string", format: "date-time" },
            notes: { type: "string", nullable: true },
            status: { type: "string" },
          },
        },
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
      "/api/onboarding": {
        post: { ...dataOperation("Onboarding", "Create the caller's initial farm, fields, and crop batches", { 201: { description: "Farm setup created" }, 409: { description: "Farm profile already exists" } }), requestBody: jsonRequest("OnboardingCreateInput") },
      },
      "/api/field-blocks": collectionEndpoints("Field blocks", "field blocks", "a field block", "FieldBlockCreateInput"),
      "/api/field-blocks/{id}": resourceEndpoints("Field blocks", "a field block", "FieldBlockUpdateInput"),
      "/api/crop-batches": collectionEndpoints("Crop batches", "crop batches", "a crop batch", "CropBatchCreateInput"),
      "/api/crop-batches/{id}": resourceEndpoints("Crop batches", "a crop batch", "CropBatchUpdateInput"),
      "/api/buyer-commitments": collectionEndpoints("Buyer commitments", "buyer commitments", "a buyer commitment", "BuyerCommitmentCreateInput"),
      "/api/buyer-commitments/{id}": resourceEndpoints("Buyer commitments", "a buyer commitment", "BuyerCommitmentUpdateInput"),
      "/health": {
        get: { tags: ["System"], summary: "Health check", responses: { 200: { description: "Service is healthy" } } },
      },
      "/health/ready": {
        get: { tags: ["System"], summary: "Database readiness", responses: { 200: { description: "The database is ready" }, 503: { description: "The database is not ready" } } },
      },
      "/": {
        get: { tags: ["System"], summary: "Service information", responses: { 200: { description: "Service metadata" } } },
      },
    },
  },
  apis: [],
});
