import type { Document } from 'mongodb';

/** Proposal only; never installed by startup or a request. */
export function proposedPointsTierGuards(): {
  validator: Document;
  index: { key: { tier: 1 }; unique: true };
} {
  return {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'tier', 'annual_points_cap', 'updated_at'],
        properties: {
          _id: { bsonType: 'string', minLength: 1 },
          tier: { enum: ['BRONZE', 'SILVER', 'GOLD'] },
          annual_points_cap: {
            bsonType: ['int', 'long', 'double'],
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
            multipleOf: 1,
          },
          updated_at: {
            bsonType: 'string',
            pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
          },
          updated_by: {
            bsonType: ['string', 'null'],
            pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
          },
        },
      },
    },
    index: { key: { tier: 1 }, unique: true },
  };
}
