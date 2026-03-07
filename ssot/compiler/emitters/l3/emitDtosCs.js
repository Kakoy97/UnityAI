"use strict";

const CSHARP_KEYWORDS = new Set([
  "abstract",
  "as",
  "base",
  "bool",
  "break",
  "byte",
  "case",
  "catch",
  "char",
  "checked",
  "class",
  "const",
  "continue",
  "decimal",
  "default",
  "delegate",
  "do",
  "double",
  "else",
  "enum",
  "event",
  "explicit",
  "extern",
  "false",
  "finally",
  "fixed",
  "float",
  "for",
  "foreach",
  "goto",
  "if",
  "implicit",
  "in",
  "int",
  "interface",
  "internal",
  "is",
  "lock",
  "long",
  "namespace",
  "new",
  "null",
  "object",
  "operator",
  "out",
  "override",
  "params",
  "private",
  "protected",
  "public",
  "readonly",
  "ref",
  "return",
  "sbyte",
  "sealed",
  "short",
  "sizeof",
  "stackalloc",
  "static",
  "string",
  "struct",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "uint",
  "ulong",
  "unchecked",
  "unsafe",
  "ushort",
  "using",
  "virtual",
  "void",
  "volatile",
  "while",
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function pascalCase(input) {
  const joined = String(input || "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  if (!joined) {
    return "Unnamed";
  }
  if (/^\d/.test(joined)) {
    return `N${joined}`;
  }
  return joined;
}

function escapeCSharpString(input) {
  return String(input || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function sanitizeFieldName(input) {
  const raw = String(input || "field").replace(/[^a-zA-Z0-9_]/g, "_");
  const withPrefix = /^\d/.test(raw) ? `_${raw}` : raw;
  if (CSHARP_KEYWORDS.has(withPrefix)) {
    return `@${withPrefix}`;
  }
  return withPrefix;
}

function mapScalarType(typeName) {
  switch (typeName) {
    case "string":
      return "string";
    case "integer":
      return "int";
    case "number":
      return "double";
    case "boolean":
      return "bool";
    default:
      return "string";
  }
}

function normalizeDefinitions(dictionary) {
  const defsFromUnderscore =
    dictionary &&
    dictionary._definitions &&
    isPlainObject(dictionary._definitions)
      ? dictionary._definitions
      : {};
  const defsFromDollar =
    dictionary && dictionary.$defs && isPlainObject(dictionary.$defs)
      ? dictionary.$defs
      : {};
  return {
    ...defsFromUnderscore,
    ...defsFromDollar,
  };
}

function resolveSchemaRef(schemaNode, definitions, visitedRefs = new Set()) {
  if (!isPlainObject(schemaNode)) {
    return schemaNode;
  }

  const refValue = typeof schemaNode.$ref === "string" ? schemaNode.$ref.trim() : "";
  if (!refValue) {
    return schemaNode;
  }
  if (visitedRefs.has(refValue)) {
    return schemaNode;
  }

  let definitionKey = "";
  if (refValue.startsWith("#/_definitions/")) {
    definitionKey = refValue.slice("#/_definitions/".length);
  } else if (refValue.startsWith("#/$defs/")) {
    definitionKey = refValue.slice("#/$defs/".length);
  } else {
    return schemaNode;
  }

  const definitionSchema = definitions[definitionKey];
  if (!isPlainObject(definitionSchema)) {
    return schemaNode;
  }

  const nextVisited = new Set(visitedRefs);
  nextVisited.add(refValue);
  return resolveSchemaRef(definitionSchema, definitions, nextVisited);
}

function emitRequiredArray(requiredFields) {
  const values = Array.isArray(requiredFields) ? requiredFields : [];
  if (values.length === 0) {
    return "new string[0]";
  }
  const encoded = values.map((field) => `"${escapeCSharpString(field)}"`).join(", ");
  return `new[] { ${encoded} }`;
}

function createEmitContext(dictionary) {
  return {
    definitions: normalizeDefinitions(dictionary),
    classNameSet: new Set(),
    classNameByKey: new Map(),
    emittedClassNames: new Set(),
    blocks: [],
  };
}

function allocateClassName(context, baseName) {
  let candidate = baseName;
  let index = 2;
  while (context.classNameSet.has(candidate)) {
    candidate = `${baseName}${index}`;
    index += 1;
  }
  context.classNameSet.add(candidate);
  return candidate;
}

function getOrCreateClassName(context, key, baseName) {
  const normalizedKey = String(key || baseName);
  if (context.classNameByKey.has(normalizedKey)) {
    return context.classNameByKey.get(normalizedKey);
  }
  const className = allocateClassName(context, baseName);
  context.classNameByKey.set(normalizedKey, className);
  return className;
}

function resolveUnionBranches(schema) {
  const branches = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : [];
  if (branches.length === 0) {
    return null;
  }
  const nonNullBranches = branches.filter(
    (branch) => !(isPlainObject(branch) && branch.type === "null")
  );
  if (nonNullBranches.length === 1) {
    return nonNullBranches[0];
  }
  return null;
}

function isObjectWithProperties(schema) {
  if (!isPlainObject(schema) || schema.type !== "object") {
    return false;
  }
  return isPlainObject(schema.properties) && Object.keys(schema.properties).length > 0;
}

function shouldEmitDictionaryForOpenObject(schemaPath) {
  return schemaPath === "execute_unity_transaction.input.steps[].payload";
}

function mapSchemaToCSharpType(context, schemaNode, options) {
  const opts = isPlainObject(options) ? options : {};
  const parentClassName = String(opts.parentClassName || "AnonymousDto");
  const propertyName = String(opts.propertyName || "value");
  const schemaPath = String(opts.schemaPath || propertyName);
  const isArrayItem = opts.isArrayItem === true;

  const resolved = resolveSchemaRef(schemaNode, context.definitions);
  if (!isPlainObject(resolved)) {
    return "string";
  }

  const unionSingle = resolveUnionBranches(resolved);
  if (unionSingle) {
    return mapSchemaToCSharpType(context, unionSingle, {
      parentClassName,
      propertyName,
      schemaPath: `${schemaPath}:union`,
      isArrayItem,
    });
  }
  if (Array.isArray(resolved.anyOf) || Array.isArray(resolved.oneOf)) {
    return "string";
  }

  if (resolved.type === "array") {
    const itemType = mapSchemaToCSharpType(context, resolved.items, {
      parentClassName,
      propertyName,
      schemaPath: `${schemaPath}[]`,
      isArrayItem: true,
    });
    return `${itemType}[]`;
  }

  if (resolved.type === "object") {
    if (!isObjectWithProperties(resolved)) {
      if (shouldEmitDictionaryForOpenObject(schemaPath)) {
        // Transaction step payload must remain structured for alias/$ref resolution.
        return "Dictionary<string, object>";
      }
      // Other open-shape objects stay as raw JSON string to preserve existing DTO semantics.
      return "string";
    }

    const classKey = `${schemaPath}|${isArrayItem ? "item" : "object"}`;
    const classBaseName =
      parentClassName +
      pascalCase(propertyName) +
      (isArrayItem ? "ItemDto" : "Dto");
    const className = getOrCreateClassName(context, classKey, classBaseName);
    emitObjectDto(context, className, resolved, schemaPath);
    return className;
  }

  return mapScalarType(resolved.type);
}

function emitObjectDto(context, className, schemaNode, schemaPath) {
  if (context.emittedClassNames.has(className)) {
    return;
  }
  context.emittedClassNames.add(className);

  const properties =
    schemaNode && isPlainObject(schemaNode.properties) ? schemaNode.properties : {};
  const entries = Object.entries(properties);

  const fieldLines =
    entries.length > 0
      ? entries.map(([propertyName, propertySchema]) => {
          const fieldType = mapSchemaToCSharpType(context, propertySchema, {
            parentClassName: className,
            propertyName,
            schemaPath: `${schemaPath}.${propertyName}`,
            isArrayItem: false,
          });
          const fieldName = sanitizeFieldName(propertyName);
          return `        public ${fieldType} ${fieldName};`;
        })
      : ["        // No explicit properties declared."];

  context.blocks.push(`    [Serializable]
    public sealed class ${className}
    {
${fieldLines.join("\n")}
    }`);
}

function emitToolDto(context, tool) {
  const className = allocateClassName(context, `${pascalCase(tool.name)}RequestDto`);
  const inputSchema = isPlainObject(tool.input) ? tool.input : {};
  const requiredFields = Array.isArray(inputSchema.required) ? inputSchema.required : [];
  const properties = isPlainObject(inputSchema.properties) ? inputSchema.properties : {};
  const entries = Object.entries(properties);

  const fieldLines =
    entries.length > 0
      ? entries.map(([propertyName, propertySchema]) => {
          const fieldType = mapSchemaToCSharpType(context, propertySchema, {
            parentClassName: className,
            propertyName,
            schemaPath: `${tool.name}.input.${propertyName}`,
            isArrayItem: false,
          });
          const fieldName = sanitizeFieldName(propertyName);
          return `        public ${fieldType} ${fieldName};`;
        })
      : ["        // No explicit input properties are declared for this tool."];

  context.blocks.push(`    [Serializable]
    public sealed class ${className}
    {
        public const string ToolName = "${escapeCSharpString(tool.name)}";
        public static readonly string[] RequiredFields = ${emitRequiredArray(requiredFields)};

${fieldLines.join("\n")}
    }`);
}

function emitDtosCs(dictionary) {
  const tools = Array.isArray(dictionary && dictionary.tools) ? dictionary.tools : [];
  const context = createEmitContext(dictionary);
  for (const tool of tools) {
    emitToolDto(context, tool);
  }
  const blocks = context.blocks.join("\n\n");

  return `// <auto-generated />
using System;
using System.Collections.Generic;

namespace UnityAI.Editor.Codex.Generated.Ssot
{
${blocks}
}
`;
}

module.exports = {
  emitDtosCs,
};
