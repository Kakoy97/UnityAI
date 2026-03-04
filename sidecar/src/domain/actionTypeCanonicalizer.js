"use strict";

function normalizeVisualActionType(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : "";
}

const VISUAL_ACTION_ALIAS_TO_CANONICAL = Object.freeze({
  // R21-detox: full alias→canonical map for all 13 deprecated aliases.
  // gameobject aliases
  create_gameobject: "create_object",
  create_object: "create_object",
  rename_gameobject: "rename_object",
  rename_object: "rename_object",
  set_gameobject_active: "set_active",
  set_active: "set_active",
  destroy_gameobject: "destroy_object",
  destroy_object: "destroy_object",
  // transform aliases
  set_transform_local_position: "set_local_position",
  set_transform_local_rotation: "set_local_rotation",
  set_transform_local_scale: "set_local_scale",
  set_transform_world_position: "set_world_position",
  set_transform_world_rotation: "set_world_rotation",
  // rect_transform aliases
  set_rect_transform_anchored_position: "set_rect_anchored_position",
  set_rect_transform_size_delta: "set_rect_size_delta",
  set_rect_transform_pivot: "set_rect_pivot",
  set_rect_transform_anchors: "set_rect_anchors",
});

function canonicalizeVisualActionType(value) {
  const normalized = normalizeVisualActionType(value);
  if (!normalized) {
    return "";
  }
  return VISUAL_ACTION_ALIAS_TO_CANONICAL[normalized] || normalized;
}

function isCreateLikeVisualActionType(value) {
  return canonicalizeVisualActionType(value) === "create_object";
}

module.exports = {
  VISUAL_ACTION_ALIAS_TO_CANONICAL,
  normalizeVisualActionType,
  canonicalizeVisualActionType,
  isCreateLikeVisualActionType,
};

