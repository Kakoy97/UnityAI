"use strict";

function registerCaseInsensitiveKeyword(ajv) {
  if (!ajv || typeof ajv.addKeyword !== "function") {
    throw new Error("registerCaseInsensitiveKeyword requires a valid Ajv instance");
  }
  if (typeof ajv.getKeyword === "function" && ajv.getKeyword("case_insensitive")) {
    return ajv;
  }
  ajv.addKeyword({
    keyword: "case_insensitive",
    schemaType: "boolean",
    errors: false,
    validate(schemaValue) {
      // Semantics are handled by pre-validation normalization.
      // This custom keyword exists to keep Ajv strict mode schema-safe.
      return schemaValue === true || schemaValue === false;
    },
  });
  return ajv;
}

module.exports = {
  registerCaseInsensitiveKeyword,
};

