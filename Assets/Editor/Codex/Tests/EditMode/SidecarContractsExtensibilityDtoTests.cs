using System;
using System.Text;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityEngine;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class SidecarContractsExtensibilityDtoTests
    {
        [Test]
        public void UnityActionRequestPayload_Deserializes_ActionDataJson()
        {
            const string actionDataJson = "{\"r\":1,\"g\":0.5,\"b\":0.25,\"a\":1}";
            var actionDataMarshaled = ToBase64Url(actionDataJson);
            var json =
                "{" +
                "\"based_on_read_token\":\"tok_ext_123456789012345678901234\"," +
                "\"requires_confirmation\":false," +
                "\"action\":{" +
                "\"type\":\"set_ui_image_color\"," +
                "\"target_anchor\":{\"object_id\":\"go_1\",\"path\":\"Scene/Canvas/Image\"}," +
                "\"action_data\":{\"r\":1,\"g\":0.5,\"b\":0.25,\"a\":1}," +
                "\"action_data_json\":\"" + Escape(actionDataJson) + "\"," +
                "\"action_data_marshaled\":\"" + actionDataMarshaled + "\"" +
                "}" +
                "}";

            var payload = JsonUtility.FromJson<UnityActionRequestPayload>(json);

            Assert.NotNull(payload);
            Assert.NotNull(payload.action);
            Assert.AreEqual("set_ui_image_color", payload.action.type);
            Assert.AreEqual(actionDataJson, payload.action.action_data_json);
            Assert.AreEqual(actionDataMarshaled, payload.action.action_data_marshaled);
        }

        [Test]
        public void UnityCapabilitiesReportRequest_Deserializes_ActionsAndSchema()
        {
            const string json =
                "{" +
                "\"event\":\"unity.capabilities.report\"," +
                "\"request_id\":\"req_cap_1\"," +
                "\"thread_id\":\"t_default\"," +
                "\"turn_id\":\"turn_cap_1\"," +
                "\"timestamp\":\"2026-03-01T00:00:00.000Z\"," +
                "\"payload\":{" +
                "\"capability_version\":\"sha256:cap_v1\"," +
                "\"actions\":[" +
                "{" +
                "\"type\":\"set_ui_image_color\"," +
                "\"anchor_policy\":\"target_required\"," +
                "\"description\":\"Set image color\"," +
                "\"domain\":\"ui\"," +
                "\"tier\":\"core\"," +
                "\"lifecycle\":\"stable\"," +
                "\"undo_safety\":\"atomic_safe\"," +
                "\"action_data_schema\":{" +
                "\"type\":\"object\"," +
                "\"required\":[\"r\",\"g\",\"b\",\"a\"]," +
                "\"properties\":[" +
                "{\"name\":\"r\",\"type\":\"number\"}," +
                "{\"name\":\"g\",\"type\":\"number\"}" +
                "]" +
                "}" +
                "}" +
                "]" +
                "}" +
                "}";

            var request = JsonUtility.FromJson<UnityCapabilitiesReportRequest>(json);

            Assert.NotNull(request);
            Assert.NotNull(request.payload);
            Assert.AreEqual("sha256:cap_v1", request.payload.capability_version);
            Assert.NotNull(request.payload.actions);
            Assert.AreEqual(1, request.payload.actions.Length);
            Assert.AreEqual("set_ui_image_color", request.payload.actions[0].type);
            Assert.AreEqual("ui", request.payload.actions[0].domain);
            Assert.AreEqual("core", request.payload.actions[0].tier);
            Assert.AreEqual("stable", request.payload.actions[0].lifecycle);
            Assert.AreEqual("atomic_safe", request.payload.actions[0].undo_safety);
            Assert.NotNull(request.payload.actions[0].action_data_schema);
            Assert.AreEqual("object", request.payload.actions[0].action_data_schema.type);
            Assert.AreEqual(4, request.payload.actions[0].action_data_schema.required.Length);
        }

        [Test]
        public void CompositeVisualActionData_Deserializes_AliasReferencesAndBindOutputs()
        {
            const string json =
                "{" +
                "\"schema_version\":\"r10.v1\"," +
                "\"transaction_id\":\"tx_ui_1\"," +
                "\"atomic_mode\":\"all_or_nothing\"," +
                "\"max_step_ms\":1500," +
                "\"steps\":[" +
                "{" +
                "\"step_id\":\"s1_create\"," +
                "\"type\":\"create_gameobject\"," +
                "\"parent_anchor\":{\"object_id\":\"go_canvas\",\"path\":\"Scene/Canvas\"}," +
                "\"action_data_json\":\"{\\\"name\\\":\\\"HPBar\\\"}\"," +
                "\"action_data_marshaled\":\"eyJuYW1lIjoiSFBCYXIifQ\"," +
                "\"bind_outputs\":[{\"source\":\"created_object\",\"alias\":\"hp_root\"}]" +
                "}," +
                "{" +
                "\"step_id\":\"s2_color\"," +
                "\"type\":\"set_ui_image_color\"," +
                "\"target_anchor_ref\":\"hp_root\"," +
                "\"action_data_json\":\"{\\\"r\\\":1,\\\"g\\\":0.2,\\\"b\\\":0.2,\\\"a\\\":1}\"," +
                "\"action_data_marshaled\":\"eyJyIjoxLCJnIjowLjIsImIiOjAuMiwiYSI6MX0\"" +
                "}" +
                "]" +
                "}";

            var data = JsonUtility.FromJson<CompositeVisualActionData>(json);

            Assert.NotNull(data);
            Assert.AreEqual("r10.v1", data.schema_version);
            Assert.AreEqual(2, data.steps.Length);
            Assert.AreEqual("hp_root", data.steps[1].target_anchor_ref);
            Assert.NotNull(data.steps[0].bind_outputs);
            Assert.AreEqual(1, data.steps[0].bind_outputs.Length);
            Assert.AreEqual("created_object", data.steps[0].bind_outputs[0].source);
            Assert.AreEqual("hp_root", data.steps[0].bind_outputs[0].alias);
            Assert.AreEqual("eyJuYW1lIjoiSFBCYXIifQ", data.steps[0].action_data_marshaled);
            Assert.AreEqual("eyJyIjoxLCJnIjowLjIsImIiOjAuMiwiYSI6MX0", data.steps[1].action_data_marshaled);
        }

        [Test]
        public void UnityPulledQueryPayload_Deserializes_CaptureSceneScreenshotFields()
        {
            const string queryPayloadJson =
                "{\"view_mode\":\"scene\",\"capture_mode\":\"final_pixels\",\"output_mode\":\"artifact_uri\",\"image_format\":\"png\",\"width\":1280,\"height\":720,\"jpeg_quality\":90,\"max_base64_bytes\":512000,\"timeout_ms\":3000,\"include_ui\":true}";
            var json =
                "{" +
                "\"query_id\":\"q_1\"," +
                "\"query_type\":\"capture_scene_screenshot\"," +
                "\"query_contract_version\":\"unity.query.v2\"," +
                "\"request_id\":\"req_1\"," +
                "\"query_payload_json\":\"" + Escape(queryPayloadJson) + "\"," +
                "\"payload\":{" +
                "\"view_mode\":\"scene\"," +
                "\"capture_mode\":\"final_pixels\"," +
                "\"output_mode\":\"artifact_uri\"," +
                "\"image_format\":\"png\"," +
                "\"width\":1280," +
                "\"height\":720," +
                "\"jpeg_quality\":90," +
                "\"max_base64_bytes\":512000," +
                "\"timeout_ms\":3000," +
                "\"include_ui\":true" +
                "}" +
                "}";

            var query = JsonUtility.FromJson<UnityPulledQuery>(json);

            Assert.NotNull(query);
            Assert.NotNull(query.payload);
            Assert.AreEqual("unity.query.v2", query.query_contract_version);
            Assert.AreEqual(queryPayloadJson, query.query_payload_json);
            Assert.AreEqual("scene", query.payload.view_mode);
            Assert.AreEqual("final_pixels", query.payload.capture_mode);
            Assert.AreEqual("artifact_uri", query.payload.output_mode);
            Assert.AreEqual("png", query.payload.image_format);
            Assert.AreEqual(1280, query.payload.width);
            Assert.AreEqual(720, query.payload.height);
            Assert.AreEqual(90, query.payload.jpeg_quality);
            Assert.AreEqual(512000, query.payload.max_base64_bytes);
            Assert.AreEqual(3000, query.payload.timeout_ms);
            Assert.IsTrue(query.payload.include_ui);
        }

        [Test]
        public void UnityPulledQueryPayload_Deserializes_GetUiTreeFields()
        {
            const string json =
                "{" +
                "\"query_id\":\"q_ui_1\"," +
                "\"query_type\":\"get_ui_tree\"," +
                "\"request_id\":\"req_ui_1\"," +
                "\"payload\":{" +
                "\"ui_system\":\"ugui\"," +
                "\"root_path\":\"Scene/Canvas/HUD\"," +
                "\"include_inactive\":true," +
                "\"include_components\":true," +
                "\"include_layout\":true," +
                "\"include_interaction\":true," +
                "\"include_text_metrics\":true," +
                "\"max_depth\":4," +
                "\"node_budget\":300," +
                "\"char_budget\":12000," +
                "\"resolution\":{\"width\":1920,\"height\":1080}," +
                "\"timeout_ms\":4000" +
                "}" +
                "}";

            var query = JsonUtility.FromJson<UnityPulledQuery>(json);

            Assert.NotNull(query);
            Assert.NotNull(query.payload);
            Assert.AreEqual("ugui", query.payload.ui_system);
            Assert.AreEqual("Scene/Canvas/HUD", query.payload.root_path);
            Assert.IsTrue(query.payload.include_inactive);
            Assert.IsTrue(query.payload.include_components);
            Assert.IsTrue(query.payload.include_layout);
            Assert.IsTrue(query.payload.include_interaction);
            Assert.IsTrue(query.payload.include_text_metrics);
            Assert.AreEqual(4, query.payload.max_depth);
            Assert.AreEqual(300, query.payload.node_budget);
            Assert.AreEqual(12000, query.payload.char_budget);
            Assert.NotNull(query.payload.resolution);
            Assert.AreEqual(1920, query.payload.resolution.width);
            Assert.AreEqual(1080, query.payload.resolution.height);
            Assert.AreEqual(4000, query.payload.timeout_ms);
        }

        [Test]
        public void UnityPulledQueryPayload_Deserializes_GetUiOverlayReportFields()
        {
            const string json =
                "{" +
                "\"query_id\":\"q_overlay_1\"," +
                "\"query_type\":\"get_ui_overlay_report\"," +
                "\"request_id\":\"req_overlay_1\"," +
                "\"payload\":{" +
                "\"root_path\":\"Scene/Canvas\"," +
                "\"scope\":{\"root_path\":\"Scene/Canvas\"}," +
                "\"include_inactive\":true," +
                "\"include_children_summary\":true," +
                "\"max_nodes\":256," +
                "\"max_children_per_canvas\":12," +
                "\"timeout_ms\":4500" +
                "}" +
                "}";

            var query = JsonUtility.FromJson<UnityPulledQuery>(json);

            Assert.NotNull(query);
            Assert.NotNull(query.payload);
            Assert.AreEqual("Scene/Canvas", query.payload.root_path);
            Assert.NotNull(query.payload.scope);
            Assert.AreEqual("Scene/Canvas", query.payload.scope.root_path);
            Assert.IsTrue(query.payload.include_inactive);
            Assert.IsTrue(query.payload.include_children_summary);
            Assert.AreEqual(256, query.payload.max_nodes);
            Assert.AreEqual(12, query.payload.max_children_per_canvas);
            Assert.AreEqual(4500, query.payload.timeout_ms);
        }

        [Test]
        public void UnityPulledQueryPayload_Deserializes_HitTestUiAtScreenPointFields()
        {
            const string json =
                "{" +
                "\"query_id\":\"q_hit_1\"," +
                "\"query_type\":\"hit_test_ui_at_screen_point\"," +
                "\"request_id\":\"req_hit_1\"," +
                "\"payload\":{" +
                "\"view_mode\":\"game\"," +
                "\"x\":512," +
                "\"y\":320," +
                "\"reference_width\":1280," +
                "\"reference_height\":720," +
                "\"max_results\":5," +
                "\"timeout_ms\":3000" +
                "}" +
                "}";

            var query = JsonUtility.FromJson<UnityPulledQuery>(json);

            Assert.NotNull(query);
            Assert.NotNull(query.payload);
            Assert.AreEqual("game", query.payload.view_mode);
            Assert.AreEqual(512, query.payload.x);
            Assert.AreEqual(320, query.payload.y);
            Assert.AreEqual(1280, query.payload.reference_width);
            Assert.AreEqual(720, query.payload.reference_height);
            Assert.AreEqual(5, query.payload.max_results);
            Assert.AreEqual(3000, query.payload.timeout_ms);
        }

        [Test]
        public void UnityPulledQueryPayload_Deserializes_HitTestUiAtViewportPointFields()
        {
            const string json =
                "{" +
                "\"query_id\":\"q_hit_vp_1\"," +
                "\"query_type\":\"hit_test_ui_at_viewport_point\"," +
                "\"request_id\":\"req_hit_vp_1\"," +
                "\"payload\":{" +
                "\"view\":\"game\"," +
                "\"coord_space\":\"viewport_px\"," +
                "\"coord_origin\":\"bottom_left\"," +
                "\"x\":960," +
                "\"y\":540," +
                "\"resolution\":{\"width\":1920,\"height\":1080}," +
                "\"scope\":{\"root_path\":\"Scene/Canvas/HUD\"}," +
                "\"max_results\":8," +
                "\"include_non_interactable\":true," +
                "\"timeout_ms\":5000" +
                "}" +
                "}";

            var query = JsonUtility.FromJson<UnityPulledQuery>(json);

            Assert.NotNull(query);
            Assert.NotNull(query.payload);
            Assert.AreEqual("viewport_px", query.payload.coord_space);
            Assert.AreEqual("bottom_left", query.payload.coord_origin);
            Assert.AreEqual(960, query.payload.x);
            Assert.AreEqual(540, query.payload.y);
            Assert.NotNull(query.payload.resolution);
            Assert.AreEqual(1920, query.payload.resolution.width);
            Assert.AreEqual(1080, query.payload.resolution.height);
            Assert.NotNull(query.payload.scope);
            Assert.AreEqual("Scene/Canvas/HUD", query.payload.scope.root_path);
            Assert.AreEqual(8, query.payload.max_results);
            Assert.IsTrue(query.payload.include_non_interactable);
            Assert.AreEqual(5000, query.payload.timeout_ms);
        }

        [Test]
        public void UnityPulledQueryPayload_Deserializes_ValidateUiLayoutFields()
        {
            const string json =
                "{" +
                "\"query_id\":\"q_validate_ui_1\"," +
                "\"query_type\":\"validate_ui_layout\"," +
                "\"request_id\":\"req_validate_ui_1\"," +
                "\"payload\":{" +
                "\"scope\":{\"root_path\":\"Scene/Canvas/HUD\"}," +
                "\"resolutions\":[" +
                "{\"name\":\"landscape_fhd\",\"width\":1920,\"height\":1080}," +
                "{\"name\":\"portrait_fhd\",\"width\":1080,\"height\":1920}" +
                "]," +
                "\"checks\":[\"OUT_OF_BOUNDS\",\"TEXT_OVERFLOW\"]," +
                "\"max_issues\":120," +
                "\"time_budget_ms\":900," +
                "\"layout_refresh_mode\":\"scoped_roots_only\"," +
                "\"timeout_ms\":12000" +
                "}" +
                "}";

            var query = JsonUtility.FromJson<UnityPulledQuery>(json);

            Assert.NotNull(query);
            Assert.NotNull(query.payload);
            Assert.NotNull(query.payload.scope);
            Assert.AreEqual("Scene/Canvas/HUD", query.payload.scope.root_path);
            Assert.NotNull(query.payload.resolutions);
            Assert.AreEqual(2, query.payload.resolutions.Length);
            Assert.AreEqual("landscape_fhd", query.payload.resolutions[0].name);
            Assert.AreEqual(1920, query.payload.resolutions[0].width);
            Assert.AreEqual(1080, query.payload.resolutions[0].height);
            Assert.NotNull(query.payload.checks);
            Assert.AreEqual(2, query.payload.checks.Length);
            Assert.AreEqual("OUT_OF_BOUNDS", query.payload.checks[0]);
            Assert.AreEqual(120, query.payload.max_issues);
            Assert.AreEqual(900, query.payload.time_budget_ms);
            Assert.AreEqual("scoped_roots_only", query.payload.layout_refresh_mode);
            Assert.AreEqual(12000, query.payload.timeout_ms);
        }

        [Test]
        public void UnityPulledQueryPayload_Deserializes_GetSerializedPropertyTreeFields()
        {
            const string json =
                "{" +
                "\"query_id\":\"q_sp_tree_1\"," +
                "\"query_type\":\"get_serialized_property_tree\"," +
                "\"request_id\":\"req_sp_tree_1\"," +
                "\"payload\":{" +
                "\"target_anchor\":{\"object_id\":\"go_btn\",\"path\":\"Scene/Canvas/Button\"}," +
                "\"component_selector\":{" +
                "\"component_assembly_qualified_name\":\"UnityEngine.UI.Image, UnityEngine.UI\"," +
                "\"component_index\":0" +
                "}," +
                "\"root_property_path\":\"\"," +
                "\"depth\":1," +
                "\"after_property_path\":\"m_Color\"," +
                "\"page_size\":64," +
                "\"node_budget\":128," +
                "\"char_budget\":12000," +
                "\"include_value_summary\":true," +
                "\"include_non_visible\":false," +
                "\"timeout_ms\":4000" +
                "}" +
                "}";

            var query = JsonUtility.FromJson<UnityPulledQuery>(json);

            Assert.NotNull(query);
            Assert.NotNull(query.payload);
            Assert.NotNull(query.payload.target_anchor);
            Assert.AreEqual("go_btn", query.payload.target_anchor.object_id);
            Assert.AreEqual("Scene/Canvas/Button", query.payload.target_anchor.path);
            Assert.NotNull(query.payload.component_selector);
            Assert.AreEqual(
                "UnityEngine.UI.Image, UnityEngine.UI",
                query.payload.component_selector.component_assembly_qualified_name);
            Assert.AreEqual(0, query.payload.component_selector.component_index);
            Assert.AreEqual(string.Empty, query.payload.root_property_path);
            Assert.AreEqual(1, query.payload.depth);
            Assert.AreEqual("m_Color", query.payload.after_property_path);
            Assert.AreEqual(64, query.payload.page_size);
            Assert.AreEqual(128, query.payload.node_budget);
            Assert.AreEqual(12000, query.payload.char_budget);
            Assert.IsTrue(query.payload.include_value_summary);
            Assert.IsFalse(query.payload.include_non_visible);
            Assert.AreEqual(4000, query.payload.timeout_ms);
        }

        [Test]
        public void UnityPulledQueryPayload_Deserializes_GetSerializedPropertyTreeComponentSelectors()
        {
            const string json =
                "{" +
                "\"query_id\":\"q_sp_tree_2\"," +
                "\"query_type\":\"get_serialized_property_tree\"," +
                "\"request_id\":\"req_sp_tree_2\"," +
                "\"payload\":{" +
                "\"target_anchor\":{\"object_id\":\"go_btn\",\"path\":\"Scene/Canvas/Button\"}," +
                "\"component_selectors\":[" +
                "{" +
                "\"component_assembly_qualified_name\":\"UnityEngine.RectTransform, UnityEngine.CoreModule\"," +
                "\"component_index\":0" +
                "}," +
                "{" +
                "\"component_assembly_qualified_name\":\"UnityEngine.UI.Image, UnityEngine.UI\"," +
                "\"component_index\":0" +
                "}" +
                "]," +
                "\"depth\":1," +
                "\"page_size\":32," +
                "\"node_budget\":128," +
                "\"char_budget\":8000" +
                "}" +
                "}";

            var query = JsonUtility.FromJson<UnityPulledQuery>(json);

            Assert.NotNull(query);
            Assert.NotNull(query.payload);
            Assert.NotNull(query.payload.component_selectors);
            Assert.AreEqual(2, query.payload.component_selectors.Length);
            Assert.AreEqual(
                "UnityEngine.RectTransform, UnityEngine.CoreModule",
                query.payload.component_selectors[0].component_assembly_qualified_name);
            Assert.AreEqual(0, query.payload.component_selectors[0].component_index);
            Assert.AreEqual(
                "UnityEngine.UI.Image, UnityEngine.UI",
                query.payload.component_selectors[1].component_assembly_qualified_name);
            Assert.AreEqual(0, query.payload.component_selectors[1].component_index);
        }

        private static string Escape(string value)
        {
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private static string ToBase64Url(string value)
        {
            var raw = value ?? string.Empty;
            return Convert
                .ToBase64String(Encoding.UTF8.GetBytes(raw))
                .TrimEnd('=')
                .Replace('+', '-')
                .Replace('/', '_');
        }
    }
}
