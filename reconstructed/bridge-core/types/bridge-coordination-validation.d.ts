// Hand-written types for reconstructed/bridge-core/src/bridge-coordination-validation.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  The author imports all three parsers in recovered
//               src/bridge-tool-dispatcher.ts:2 and feeds their results
//               straight into storeTodos(todos: BridgeTodo[], ...) at lines
//               413 and 417. That fixes the return type: these functions
//               produce the author's own `BridgeTodo`, declared verbatim in
//               src/bridge-constants.ts:253-257. parseBridgeProgress is
//               destructured at line 398 as
//               `{ message, phase, percent, linkedTodo }`.
//   OBSERVED    Every limit and message below is a literal in the shipped
//               implementation: id 1-80 chars, title/step 1-400,
//               message <= 2000, phase truncated to 160, percent an integer
//               0-100, and at most one in_progress item.
//   INFERRED    `phase`, `percent` and `linkedTodo` are optional on the
//               progress result because each is left undefined when absent;
//               the author destructures them without null checks, which only
//               type-checks if they are declared optional rather than absent.

/** Todo lifecycle, exactly as the author declares it (bridge-constants.ts:256). */
export type BridgeTodoStatus = 'pending' | 'in_progress' | 'completed';

/**
 * A coordination todo.
 *
 * Mirrors the author's `BridgeTodo`. Both parsers normalise into this shape, so
 * set_todos and update_plan converge on one representation.
 */
export interface BridgeTodo {
	readonly id: string;
	readonly title: string;
	readonly status: BridgeTodoStatus;
}

/** Result of validating a report_progress call. */
export interface BridgeProgressReport {
	readonly message: string;
	/** Trimmed and truncated to 160 characters; absent when not supplied. */
	readonly phase?: string;
	/** Integer 0-100 when supplied. */
	readonly percent?: number;
	/**
	 * The todo this progress refers to.
	 *
	 * An explicit todo_id must match a current todo or the call is rejected.
	 * Without one, the single in_progress todo is linked implicitly - and stays
	 * undefined when there is none.
	 */
	readonly linkedTodo?: BridgeTodo;
}

/** Narrows to a plain object, returning {} for arrays, null and primitives. */
export function asRecord2(value: unknown): Record<string, unknown>;

/**
 * Validates a todo status.
 *
 * @param scope Path used in the error message, e.g. `set_todos.todos[0]`.
 * @throws if the status is not one of the three permitted values.
 */
export function assertTodoStatus(
	status: unknown,
	scope: string
): asserts status is BridgeTodoStatus;

/**
 * Enforces the single-active-item rule.
 *
 * @throws if more than one todo is in_progress. The message names the calling
 * tool, so the model sees which of set_todos / update_plan it violated.
 */
export function assertSingleInProgress(
	todos: readonly BridgeTodo[],
	toolName: string
): void;

/**
 * Validates a set_todos payload.
 *
 * Ids must be unique and 1-80 characters, titles 1-400, and at most one item
 * may be in_progress.
 *
 * @throws on any violation - this never returns a partially valid list.
 */
export function parseBridgeTodos(value: unknown, maxTodos: number): BridgeTodo[];

/**
 * Validates an update_plan payload.
 *
 * Plan steps carry no ids of their own, so positional ids `plan-1`, `plan-2`
 * are assigned. Renumbering on every call is intentional: a plan is replaced
 * wholesale rather than patched.
 *
 * @throws on any violation.
 */
export function parseBridgePlan(value: unknown, maxTodos: number): BridgeTodo[];

/**
 * Validates a report_progress payload against the todos currently in scope.
 *
 * @throws if the message is empty or over 2000 characters, if percent is not an
 * integer in 0-100, or if an explicit todo_id matches no current todo.
 */
export function parseBridgeProgress(
	value: unknown,
	todos: readonly BridgeTodo[]
): BridgeProgressReport;
