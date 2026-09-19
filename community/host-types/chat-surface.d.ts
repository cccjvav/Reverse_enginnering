// RECONSTRUCTED candidate declaration - NOT the author's original.
//
// ShunCode 0.7.4 was built against a forked Code OSS whose
// vscode.proposed.chatParticipantAdditions.d.ts declared eleven members on
// ChatSimpleToolResultData that the public proposed API does not. Those
// declarations were build-time inputs and were never packaged: the installer's
// own out/vscode-dts/vscode.d.ts is byte-identical to the public candidate and
// declares none of them.
//
// So this file is reconstructed from the author's own code, not recovered. It
// is deliberately kept in community/ rather than added to reference/, because
// reference/vscode-types holds the pinned PUBLIC declarations and must stay
// unmodified - a test enforces that. Editing those would fabricate a host and
// turn eleven honest errors green while recovering nothing.
//
// EVIDENCE. Every member below is justified by the author's own source, mostly
// by annotations that had to match the real declaration in order to compile:
//
//   items             tool-presentation.ts:129,153 spell out the element type
//   metrics           five inline constructions, always { label, value } strings
//   diffPreview       indexed three levels deep at :220-225; the line literals
//                     at :265-269 give the discriminated union
//   presentationKind  declared return type at :27 plus seven exhaustive returns
//   summary/diff/
//   terminalId        the author's own ParsedPresentation interface, :14-23
//   isError           Boolean(...) at :445, so necessarily boolean
//   durationMs        number | undefined throughout
//   detailsLabel      MEDIUM confidence - one literal, "Technical details"
//   presentationStyle LOW confidence - only "shuncode" is ever used, so the
//                     real domain may be wider
//
// Verified by npm run verify:host-shapes, which compiles the author's real code
// against these shapes and also compiles a deliberately broken control that
// must fail.
//
// KNOWN UNRESOLVED: the shipped bundle contains a second copy of
// parseUnifiedDiffPreview building { oldPath, newPath, hunks } rather than
// { path, hunks }. Either the host element permits both spellings or the two
// copies drifted. Recorded rather than smoothed over.

import type { Location, Uri } from 'vscode';

declare module 'vscode' {
	/** One clickable row in a tool card. */
	interface ChatToolResultItem {
		label: string;
		description?: string;
		/** Makes the row navigable - a Location jumps to a line. */
		resource?: Uri | Location;
	}

	/** A small statistic chip, e.g. { label: "Matches", value: "12" }. */
	interface ChatToolResultMetric {
		label: string;
		/** Always stringified at the call site, never a number. */
		value: string;
	}

	/** One line of a diff preview. Discriminated on `kind`. */
	type ChatToolDiffLine =
		| { kind: 'add'; newLine: number; text: string }
		| { kind: 'delete'; oldLine: number; text: string }
		| { kind: 'context'; oldLine: number; newLine: number; text: string };

	interface ChatToolDiffHunk {
		lines: ChatToolDiffLine[];
		/** Set when the hunk hit the per-hunk line cap. */
		truncated?: boolean;
	}

	interface ChatToolDiffFile {
		path: string;
		hunks: ChatToolDiffHunk[];
		/** Set when the file hit the per-file hunk cap. */
		truncated?: boolean;
	}

	/** Chooses the card's icon and layout. */
	type ChatToolPresentationKind =
		| 'files'
		| 'search'
		| 'edit'
		| 'terminal'
		| 'diagnostics'
		| 'lsp'
		| 'generic';

	/**
	 * The eleven members the author's fork added.
	 *
	 * Interface merging, so the public `input` and `output` stay exactly as the
	 * pinned declaration defines them. Everything here is optional, which
	 * matches how the author constructs the object - several members are set to
	 * undefined on purpose.
	 */
	interface ChatSimpleToolResultData {
		/** Clickable file or match list. */
		items?: ChatToolResultItem[];
		/** Statistic chips. Only populated once the invocation completes. */
		metrics?: ChatToolResultMetric[];
		/** Structured diff rendering. */
		diffPreview?: ChatToolDiffFile[];
		/** Raw unified diff text, kept alongside the structured preview. */
		diff?: string;
		/** One-line description under the title. */
		summary?: string;
		/** Label for the collapsible technical section. */
		detailsLabel?: string;
		/** Links the card to a managed terminal. */
		terminalId?: string;
		/** Renders the card in the failure style. */
		isError?: boolean;
		/** Elapsed time, surfaced as a metric chip. */
		durationMs?: number;
		/** Icon and layout selector. */
		presentationKind?: ChatToolPresentationKind;
		/**
		 * Opt-in ShunCode card skin, driven by the
		 * `shuncode.chat.bridgeStyleUI` setting.
		 *
		 * LOW CONFIDENCE: only "shuncode" is ever used in the recovered
		 * sources, so the fork may have accepted other values.
		 */
		presentationStyle?: 'shuncode';
	}
}
