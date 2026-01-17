export const swaggerSchemas = {
  ErrorResponse: {
    type: "object",
    properties: {
      error: {
        type: "object",
        properties: {
          code: {
            type: "string",
            example: "VALIDATION_ERROR",
          },
          message: {
            type: "string",
            example: "Invalid request: liked_perfume_ids must contain at least 1 element",
          },
          requestId: {
            type: "string",
            example: "ebf4baa4-728d-422c-9cf4-7c763cef9349",
          },
        },
        required: ["code", "message"],
      },
    },
    required: ["error"],
  },
  HealthData: {
    type: "object",
    properties: {
      status: {
        type: "string",
        example: "healthy",
      },
      currentTime: {
        type: "string",
        format: "date-time",
        example: "2024-01-15T10:30:00.000Z",
      },
      responseTimeMs: {
        type: "number",
        example: 5,
      },
      uptimeMs: {
        type: "number",
        example: 3600000,
      },
    },
    required: ["status", "currentTime", "responseTimeMs", "uptimeMs"],
  },
  HealthResponse: {
    type: "object",
    properties: {
      data: {
        $ref: "#/components/schemas/HealthData",
      },
      meta: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            example: "ebf4baa4-728d-422c-9cf4-7c763cef9349",
          },
        },
      },
    },
    required: ["data", "meta"],
  },
  RecommendationSignals: {
    type: "object",
    properties: {
      sim: {
        type: "number",
        description: "Similarity score (0-1)",
        example: 0.9,
      },
      dna: {
        type: "number",
        description: "DNA overlap score (0-1)",
        example: 0.74,
      },
      ward: {
        type: "number",
        description: "Wardrobe co-occurrence score (0-1)",
        example: 0.62,
      },
      qual: {
        type: "number",
        description: "Rating quality score (0-1)",
        example: 0.58,
      },
      perf: {
        type: "number",
        description: "Performance score (0-1)",
        example: 0.41,
      },
    },
    required: ["sim", "dna", "ward", "qual", "perf"],
  },
  RecommendationPerformance: {
    type: "object",
    nullable: true,
    properties: {
      longevity: {
        type: "number",
        nullable: true,
        example: 8.4,
      },
      longevity_votes: {
        type: "number",
        nullable: true,
        example: 150,
      },
      sillage: {
        type: "number",
        nullable: true,
        example: 7.9,
      },
      sillage_votes: {
        type: "number",
        nullable: true,
        example: 142,
      },
    },
  },
  RecommendationWhy: {
    type: "object",
    properties: {
      because_similar_to: {
        type: "number",
        nullable: true,
        description: "ID of the most similar liked perfume",
        example: 75805,
      },
      shared_notes: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Top 3 shared notes",
        example: ["vanilla", "lavender", "sandalwood"],
      },
      shared_accords: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Top 3 shared accords",
        example: ["amber", "warm spicy", "woody"],
      },
      wardrobe: {
        type: "array",
        items: {
          type: "object",
          properties: {
            liked_id: {
              type: "number",
            },
            co_count: {
              type: "number",
            },
          },
        },
        description: "Wardrobe co-occurrence pairs",
        example: [{ liked_id: 75805, co_count: 9 }],
      },
      performance: {
        $ref: "#/components/schemas/RecommendationPerformance",
      },
    },
    required: ["because_similar_to", "shared_notes", "shared_accords", "wardrobe", "performance"],
  },
  RecommendationResult: {
    type: "object",
    properties: {
      id: {
        type: "number",
        example: 56324,
      },
      name: {
        type: "string",
        example: "Sauvage Parfum",
      },
      brand: {
        type: "string",
        example: "Dior",
      },
      year: {
        type: "number",
        nullable: true,
        example: 2019,
      },
      description: {
        type: "string",
        nullable: true,
        example: "A modern fougère fragrance...",
      },
      perfumer: {
        type: "string",
        nullable: true,
        example: "François Demachy",
      },
      gender: {
        type: "string",
        nullable: true,
        enum: ["male", "female", "unisex"],
        example: "male",
      },
      accords: {
        type: "array",
        items: {
          type: "string",
        },
        example: ["amber", "warm spicy", "woody"],
      },
      notes: {
        type: "array",
        items: {
          type: "string",
        },
        example: ["vanilla", "lavender", "sandalwood"],
      },
      image: {
        type: "string",
        format: "uri",
        example: "https://fimgs.net/mdimg/perfume-thumbs/375x500.56324.2x.avif",
      },
      score: {
        type: "number",
        description: "Final recommendation score (0-1)",
        example: 0.823,
      },
      signals: {
        $ref: "#/components/schemas/RecommendationSignals",
      },
      why: {
        $ref: "#/components/schemas/RecommendationWhy",
      },
    },
    required: [
      "id",
      "name",
      "brand",
      "year",
      "description",
      "perfumer",
      "gender",
      "accords",
      "notes",
      "image",
      "score",
      "signals",
      "why",
    ],
  },
  SimilarPerfumesResponse: {
    type: "object",
    properties: {
      liked_count: {
        type: "number",
        description: "Number of liked perfumes provided",
        example: 3,
      },
      results: {
        type: "array",
        items: {
          $ref: "#/components/schemas/RecommendationResult",
        },
      },
    },
    required: ["liked_count", "results"],
  },
  SimilarPerfumesRequest: {
    type: "object",
    required: ["liked_perfume_ids"],
    properties: {
      liked_perfume_ids: {
        type: "array",
        items: {
          type: "number",
        },
        minItems: 1,
        maxItems: 10,
        description: "Array of 1-10 perfume IDs that the user likes",
        example: [42260, 75805, 52802],
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 20,
        default: 10,
        description: "Number of recommendations to return (1-20)",
        example: 10,
      },
      diversify_brand: {
        type: "boolean",
        default: true,
        description: "Limit to max 1 perfume per brand in results",
        example: true,
      },
      min_votes: {
        type: "number",
        minimum: 0,
        default: 0,
        description: "Minimum vote threshold (currently not enforced)",
        example: 0,
      },
      prefer_longlasting: {
        type: "boolean",
        default: false,
        description: "Prioritize perfumes with high longevity (currently not implemented)",
        example: false,
      },
      prefer_soft_projection: {
        type: "boolean",
        default: false,
        description: "Prioritize perfumes with lower sillage/soft projection (currently not implemented)",
        example: false,
      },
      gender: {
        type: "string",
        enum: ["male", "female", "unisex"],
        description: "Filter results by gender. Omit for all genders",
        example: "male",
      },
    },
  },
  SimilarPerfumesResponseWrapper: {
    type: "object",
    properties: {
      data: {
        $ref: "#/components/schemas/SimilarPerfumesResponse",
      },
      meta: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            example: "ebf4baa4-728d-422c-9cf4-7c763cef9349",
          },
        },
      },
    },
    required: ["data", "meta"],
  },
};
