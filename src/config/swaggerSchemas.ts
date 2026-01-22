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
            example:
              "Invalid request: liked_perfume_ids must contain at least 1 element",
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
    required: [
      "because_similar_to",
      "shared_notes",
      "shared_accords",
      "wardrobe",
      "performance",
    ],
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
      dna_card: {
        $ref: "#/components/schemas/DnaCard",
        description: "DNA card with top families, accords, and notes",
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
      fingerprint: {
        $ref: "#/components/schemas/TasteFingerprint",
        description: "User taste fingerprint (optional)",
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
        description:
          "Prioritize perfumes with high longevity (currently not implemented)",
        example: false,
      },
      prefer_soft_projection: {
        type: "boolean",
        default: false,
        description:
          "Prioritize perfumes with lower sillage/soft projection (currently not implemented)",
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
  DnaCard: {
    type: "object",
    properties: {
      families: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              example: "Amber",
            },
            weight: {
              type: "number",
              example: 1.0,
            },
          },
          required: ["name", "weight"],
        },
        description: "Top 3 DNA families",
        example: [
          { name: "Amber", weight: 1.0 },
          { name: "Gourmand", weight: 1.0 },
          { name: "Woody", weight: 1.0 },
        ],
      },
      accords: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              example: "vanilla",
            },
            weight: {
              type: "number",
              example: 0.18,
            },
            percentage: {
              type: "number",
              example: 18.0,
            },
          },
          required: ["name", "weight", "percentage"],
        },
        description: "All accords with percentages (sums to 100%)",
        example: [
          { name: "vanilla", weight: 0.18, percentage: 18.0 },
          { name: "amber", weight: 0.14, percentage: 14.0 },
          { name: "woody", weight: 0.1, percentage: 10.0 },
        ],
      },
      notes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              example: "vanilla",
            },
            weight: {
              type: "number",
              example: 0.2,
            },
            percentage: {
              type: "number",
              example: 20.0,
            },
          },
          required: ["name", "weight", "percentage"],
        },
        description: "All notes with percentages (sums to 100%)",
        example: [
          { name: "vanilla", weight: 0.2, percentage: 20.0 },
          { name: "benzoin", weight: 0.12, percentage: 12.0 },
          { name: "tonka", weight: 0.09, percentage: 9.0 },
        ],
      },
    },
    required: ["families", "accords", "notes"],
  },
  MissingSuggestionPerfume: {
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
      image: {
        type: "string",
        format: "uri",
        example: "https://fimgs.net/mdimg/perfume-thumbs/375x500.56324.2x.avif",
      },
    },
    required: ["id", "name", "brand", "image"],
  },
  MissingSuggestion: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["family", "accord", "note"],
        example: "family",
      },
      name: {
        type: "string",
        example: "fresh",
      },
      suggestion: {
        type: "string",
        example:
          "You have almost no fresh citrus. Try one clean summer signature.",
      },
      perfumes: {
        type: "array",
        items: {
          $ref: "#/components/schemas/MissingSuggestionPerfume",
        },
        description: "3 recommended perfumes for this missing category",
        example: [
          {
            id: 56324,
            name: "Sauvage Parfum",
            brand: "Dior",
            image: "https://fimgs.net/mdimg/perfume-thumbs/375x500.56324.2x.avif",
          },
        ],
      },
    },
    required: ["category", "name", "suggestion", "perfumes"],
  },
  TasteFingerprint: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Dynamic template-based taste summary",
        example:
          "You like gourmand and amber scents with vanilla and tonka, warm and cozy.",
      },
      families: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              example: "Amber",
            },
            percentage: {
              type: "number",
              example: 32.0,
            },
          },
          required: ["name", "percentage"],
        },
        description: "Top families with percentages",
        example: [
          { name: "Amber", percentage: 32.0 },
          { name: "Gourmand", percentage: 21.0 },
          { name: "Woody", percentage: 18.0 },
        ],
      },
      accords: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              example: "vanilla",
            },
            percentage: {
              type: "number",
              example: 22.0,
            },
          },
          required: ["name", "percentage"],
        },
        description: "Top accords with percentages",
        example: [
          { name: "vanilla", percentage: 22.0 },
          { name: "amber", percentage: 16.0 },
          { name: "sweet", percentage: 11.0 },
        ],
      },
      notes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              example: "vanilla",
            },
            percentage: {
              type: "number",
              example: 25.0,
            },
          },
          required: ["name", "percentage"],
        },
        description: "Top notes with percentages",
        example: [
          { name: "vanilla", percentage: 25.0 },
          { name: "tonka bean", percentage: 15.0 },
          { name: "amberwood", percentage: 12.0 },
        ],
      },
      missing: {
        type: "array",
        items: {
          $ref: "#/components/schemas/MissingSuggestion",
        },
        description: "2-3 suggestions for missing categories",
        example: [
          {
            category: "family",
            name: "fresh",
            suggestion:
              "You have almost no fresh citrus. Try one clean summer signature.",
          },
        ],
      },
    },
    required: ["summary", "families", "accords", "notes", "missing"],
  },
};
