"use strict";

const BLOCK_TYPE = Object.freeze({
  READ_STATE: "READ_STATE",
  CREATE: "CREATE",
  MUTATE: "MUTATE",
  VERIFY: "VERIFY",
});

const BLOCK_TYPE_VALUES = Object.freeze(Object.values(BLOCK_TYPE));

const WRITE_BLOCK_TYPES = new Set([BLOCK_TYPE.CREATE, BLOCK_TYPE.MUTATE]);

function isBlockType(value) {
  return typeof value === "string" && BLOCK_TYPE_VALUES.includes(value);
}

module.exports = {
  BLOCK_TYPE,
  BLOCK_TYPE_VALUES,
  WRITE_BLOCK_TYPES,
  isBlockType,
};

