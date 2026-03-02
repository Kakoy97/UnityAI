"use strict";

const { withMcpErrorFeedback } = require("../../../application/mcpGateway/mcpErrorFeedback");

async function executeHitTestUiAtScreenPoint() {
  return {
    statusCode: 409,
    body: withMcpErrorFeedback({
      status: "failed",
      error_code: "E_COMMAND_DISABLED",
      message:
        "hit_test_ui_at_screen_point is disabled in screenshot stabilization closure. " +
        "Use get_ui_tree with capture_scene_screenshot(capture_mode=render_output).",
    }),
  };
}

module.exports = {
  executeHitTestUiAtScreenPoint,
};
