// RECONSTRUCTED from src/tool-input-validation.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


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

function fail(path22, message) {
  throw new Error(`INVALID_ARGUMENT: ${path22} ${message}`);
}

function validateType(path22, expected, value) {
  if (typeof expected !== "string") return;
  const valid = expected === "object" ? Boolean(value) && typeof value === "object" && !Array.isArray(value) : expected === "array" ? Array.isArray(value) : expected === "integer" ? Number.isInteger(value) : expected === "number" ? typeof value === "number" && Number.isFinite(value) : expected === "string" ? typeof value === "string" : expected === "boolean" ? typeof value === "boolean" : expected === "null" ? value === null : true;
  if (!valid) fail(path22, `must be ${expected}; received ${valueType(value)}.`);
}

function validateSchema(schema, value, path22) {
  validateType(path22, schema.type, value);
  if (Array.isArray(schema.enum) && !schema.enum.some((allowed) => sameJsonValue2(allowed, value))) {
    fail(path22, `must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}.`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      fail(path22, `must contain at least ${schema.minLength} characters.`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      fail(path22, `must contain at most ${schema.maxLength} characters.`);
    }
    if (typeof schema.pattern === "string") {
      let regex;
      try {
        regex = new RegExp(schema.pattern);
      } catch (error2) {
        throw new Error(`Invalid tool input schema pattern at ${path22}: ${error2.message}`);
      }
      if (!regex.test(value)) fail(path22, `must match pattern ${JSON.stringify(schema.pattern)}.`);
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      fail(path22, `must be >= ${schema.minimum}.`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      fail(path22, `must be <= ${schema.maximum}.`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      fail(path22, `must contain at least ${schema.minItems} items.`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      fail(path22, `must contain at most ${schema.maxItems} items.`);
    }
    if (schema.uniqueItems === true) {
      for (let index = 0; index < value.length; index += 1) {
        for (let previous = 0; previous < index; previous += 1) {
          if (sameJsonValue2(value[index], value[previous])) fail(`${path22}[${index}]`, "must be unique within the array.");
        }
      }
    }
    const itemSchema = schemaObject(schema.items);
    if (itemSchema) value.forEach((item, index) => validateSchema(itemSchema, item, `${path22}[${index}]`));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value;
    const properties = schemaObject(schema.properties) ?? {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && (!Object.prototype.hasOwnProperty.call(row, key) || row[key] === void 0)) {
          fail(`${path22}.${key}`, "is required.");
        }
      }
    }
    for (const [key, item] of Object.entries(row)) {
      const propertySchema = schemaObject(properties[key]);
      if (propertySchema) {
        validateSchema(propertySchema, item, `${path22}.${key}`);
        continue;
      }
      if (schema.additionalProperties === false) fail(`${path22}.${key}`, "is not an allowed property.");
      const additionalSchema = schemaObject(schema.additionalProperties);
      if (additionalSchema) validateSchema(additionalSchema, item, `${path22}.${key}`);
    }
  }
}

function validateToolInput(toolName, inputSchema, input) {
  const schema = schemaObject(inputSchema);
  if (!schema) throw new Error(`Invalid input schema for tool ${toolName}.`);
  validateSchema(schema, input, toolName);
}

export { fail, sameJsonValue2, schemaObject, validateSchema, validateToolInput, validateType, valueType };
