// RECONSTRUCTED from src/bridge-coordination-validation.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


function asRecord2(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function assertTodoStatus(status, scope) {
  if (status !== "pending" && status !== "in_progress" && status !== "completed") {
    throw new Error(`${scope}.status must be pending, in_progress, or completed.`);
  }
}

function assertSingleInProgress(todos, toolName) {
  if (todos.filter((todo) => todo.status === "in_progress").length > 1) {
    if (toolName === "set_todos") {
      throw new Error("set_todos supports at most one in_progress todo.");
    }
    throw new Error("update_plan supports at most one in_progress item.");
  }
}

function parseBridgeTodos(value, maxTodos) {
  const input = asRecord2(value);
  if (!Array.isArray(input.todos)) throw new Error("set_todos.todos must be an array.");
  if (input.todos.length > maxTodos) throw new Error(`set_todos.todos must contain at most ${maxTodos} items.`);
  const seen = /* @__PURE__ */ new Set();
  const todos = input.todos.map((raw, index) => {
    const item = asRecord2(raw);
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const status = item.status;
    if (!id || id.length > 80) throw new Error(`set_todos.todos[${index}].id must be 1-80 characters.`);
    if (seen.has(id)) throw new Error(`set_todos.todos contains duplicate id: ${id}`);
    seen.add(id);
    if (!title || title.length > 400) throw new Error(`set_todos.todos[${index}].title must be 1-400 characters.`);
    assertTodoStatus(status, `set_todos.todos[${index}]`);
    return { id, title, status };
  });
  assertSingleInProgress(todos, "set_todos");
  return todos;
}

function parseBridgePlan(value, maxTodos) {
  const input = asRecord2(value);
  if (!Array.isArray(input.plan)) throw new Error("update_plan.plan must be an array.");
  if (input.plan.length > maxTodos) throw new Error(`update_plan.plan must contain at most ${maxTodos} items.`);
  const todos = input.plan.map((raw, index) => {
    const item = asRecord2(raw);
    const title = typeof item.step === "string" ? item.step.trim() : "";
    if (!title || title.length > 400) {
      throw new Error(`update_plan.plan[${index}].step must be 1-400 characters.`);
    }
    assertTodoStatus(item.status, `update_plan.plan[${index}]`);
    return {
      id: `plan-${index + 1}`,
      title,
      status: item.status
    };
  });
  assertSingleInProgress(todos, "update_plan");
  return todos;
}

function parseBridgeProgress(value, todos) {
  const input = asRecord2(value);
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) throw new Error("report_progress.message must be a non-empty string.");
  if (message.length > 2e3) throw new Error("report_progress.message must be at most 2000 characters.");
  const phase = typeof input.phase === "string" ? input.phase.trim().slice(0, 160) : void 0;
  let percent;
  if (input.percent !== void 0) {
    if (!Number.isInteger(input.percent) || Number(input.percent) < 0 || Number(input.percent) > 100) {
      throw new Error("report_progress.percent must be an integer from 0 to 100.");
    }
    percent = Number(input.percent);
  }
  const requestedTodoId = typeof input.todo_id === "string" ? input.todo_id.trim() : "";
  let linkedTodo;
  if (requestedTodoId) {
    linkedTodo = todos.find((todo) => todo.id === requestedTodoId);
    if (!linkedTodo) throw new Error(`report_progress.todo_id does not match a current todo: ${requestedTodoId}`);
  } else {
    linkedTodo = todos.find((todo) => todo.status === "in_progress");
  }
  return { message, phase, percent, linkedTodo };
}

export { asRecord2, assertSingleInProgress, assertTodoStatus, parseBridgePlan, parseBridgeProgress, parseBridgeTodos };
