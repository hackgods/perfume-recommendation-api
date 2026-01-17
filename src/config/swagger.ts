import swaggerJsdoc from "swagger-jsdoc";
import { swaggerSchemas } from "./swaggerSchemas";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Perfume Recommendation API",
      version: "1.0.0",
      description:
        "A production-grade API for perfume recommendations using hybrid ranking. " +
        "Combines semantic embeddings, DNA overlap, wardrobe co-occurrence, ratings, and performance metrics " +
        "to provide accurate and explainable perfume recommendations.",
      contact: {
        name: "API Support",
      },
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Development server",
      },
      {
        url: process.env.API_URL || "https://api.example.com",
        description: "Production server",
      },
    ],
    tags: [
      {
        name: "Health",
        description: "Health check and system status endpoints",
      },
      {
        name: "Recommendations",
        description: "Perfume recommendation endpoints",
      },
    ],
    components: {
      schemas: swaggerSchemas,
      responses: {
        ValidationError: {
          description: "Validation error",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ErrorResponse",
              },
              example: {
                error: {
                  code: "VALIDATION_ERROR",
                  message: "Invalid request: liked_perfume_ids must contain at least 1 element",
                  requestId: "ebf4baa4-728d-422c-9cf4-7c763cef9349",
                },
              },
            },
          },
        },
        NotFound: {
          description: "Resource not found",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ErrorResponse",
              },
              example: {
                error: {
                  code: "NOT_FOUND",
                  message: "Perfume IDs not found: 84546, 89584",
                  requestId: "ebf4baa4-728d-422c-9cf4-7c763cef9349",
                },
              },
            },
          },
        },
        InternalServerError: {
          description: "Internal server error",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ErrorResponse",
              },
              example: {
                error: {
                  code: "INTERNAL_SERVER_ERROR",
                  message: "An unexpected error occurred",
                  requestId: "ebf4baa4-728d-422c-9cf4-7c763cef9349",
                },
              },
            },
          },
        },
      },
    },
  },
  apis: ["./src/routes/*.ts", "./dist/routes/*.js"],
};

export const swaggerSpec = swaggerJsdoc(options);
