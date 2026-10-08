// EXTRACTED from src/tool-input-validation.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

function schemaObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}
function sameJsonValue2(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
function fail(path36, message2) {
  throw new Error(`INVALID_ARGUMENT: ${path36} ${message2}`);
}
function validateType(path36, expected, value) {
  if (typeof expected !== "string") return;
  const valid = expected === "object" ? Boolean(value) && typeof value === "object" && !Array.isArray(value) : expected === "array" ? Array.isArray(value) : expected === "integer" ? Number.isInteger(value) : expected === "number" ? typeof value === "number" && Number.isFinite(value) : expected === "string" ? typeof value === "string" : expected === "boolean" ? typeof value === "boolean" : expected === "null" ? value === null : true;
  if (!valid) fail(path36, `must be ${expected}; received ${valueType(value)}.`);
}
function validateSchema(schema, value, path36) {
  validateType(path36, schema.type, value);
  if (Array.isArray(schema.enum) && !schema.enum.some((allowed) => sameJsonValue2(allowed, value))) {
    fail(path36, `must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}.`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      fail(path36, `must contain at least ${schema.minLength} characters.`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      fail(path36, `must contain at most ${schema.maxLength} characters.`);
    }
    if (typeof schema.pattern === "string") {
      let regex;
      try {
        regex = new RegExp(schema.pattern);
      } catch (error2) {
        throw new Error(`Invalid tool input schema pattern at ${path36}: ${error2.message}`);
      }
      if (!regex.test(value)) fail(path36, `must match pattern ${JSON.stringify(schema.pattern)}.`);
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      fail(path36, `must be >= ${schema.minimum}.`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      fail(path36, `must be <= ${schema.maximum}.`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      fail(path36, `must contain at least ${schema.minItems} items.`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      fail(path36, `must contain at most ${schema.maxItems} items.`);
    }
    if (schema.uniqueItems === true) {
      for (let index = 0; index < value.length; index += 1) {
        for (let previous = 0; previous < index; previous += 1) {
          if (sameJsonValue2(value[index], value[previous])) fail(`${path36}[${index}]`, "must be unique within the array.");
        }
      }
    }
    const itemSchema = schemaObject(schema.items);
    if (itemSchema) value.forEach((item, index) => validateSchema(itemSchema, item, `${path36}[${index}]`));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value;
    const properties = schemaObject(schema.properties) ?? {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && (!Object.prototype.hasOwnProperty.call(row, key) || row[key] === void 0)) {
          fail(`${path36}.${key}`, "is required.");
        }
      }
    }
    for (const [key, item] of Object.entries(row)) {
      const propertySchema = schemaObject(properties[key]);
      if (propertySchema) {
        validateSchema(propertySchema, item, `${path36}.${key}`);
        continue;
      }
      if (schema.additionalProperties === false) fail(`${path36}.${key}`, "is not an allowed property.");
      const additionalSchema = schemaObject(schema.additionalProperties);
      if (additionalSchema) validateSchema(additionalSchema, item, `${path36}.${key}`);
    }
  }
}
function validateToolInput(toolName, inputSchema, input) {
  const schema = schemaObject(inputSchema);
  if (!schema) throw new Error(`Invalid input schema for tool ${toolName}.`);
  validateSchema(schema, input, toolName);
}
