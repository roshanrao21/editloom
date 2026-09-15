import Ajv2020 from "ajv/dist/2020.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const schema = require("../../../schemas/edl/v1.0.0.schema.json");
const schemaVersion = schema.properties.schema_version.const;
const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function validationError(error) {
  return {
    instancePath: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message || "failed validation",
    params: error.params
  };
}

/**
 * Validates one EDL against the schema version used by future render jobs.
 * The returned schema identity is designed to be persisted with a validation
 * result before a render is queued.
 */
export function validateEdl(edl) {
  const valid = validator(edl);

  return {
    valid,
    schemaId: schema.$id,
    schemaVersion,
    errors: valid ? [] : (validator.errors || []).map(validationError)
  };
}
